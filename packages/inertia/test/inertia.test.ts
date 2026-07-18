import { afterEach, describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { inertia } from '../src/plugin'
import { Inertia } from '../src/response'

afterEach(() => Inertia.flushShared())

function build(config = {}) {
  return new Elysia()
    .use(inertia(config))
    .get('/home', () => Inertia.render('Home', { name: 'Sam' }))
    .get('/lazy', () =>
      Inertia.render('Lazy', {
        always: Inertia.always(() => 'A'),
        maybe: Inertia.optional(() => 'M'),
        normal: 'N',
      }))
    .get('/external', () => Inertia.location('https://example.com'))
}

function inertiaReq(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-inertia': 'true', 'x-inertia-version': '', ...headers },
  })
}

describe('first (non-XHR) load', () => {
  test('returns an HTML document embedding the page object', async () => {
    const res = await build().handle(new Request('http://localhost/home'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<div id="app"></div>') // empty mount root
    // Inertia v3 reads the initial page from a JSON script tag, not a div attr.
    expect(body).toContain('<script type="application/json" data-page="app">')
    expect(body).toContain('"component":"Home"') // JSON in the script's text content
    expect(body).toContain('Sam')
  })

  test('vite tags inject the dev client + entry when no manifest', async () => {
    const res = await build({ vite: { entry: 'resources/js/app.ts' } }).handle(
      new Request('http://localhost/home'),
    )
    const body = await res.text()
    expect(body).toContain('http://localhost:5173/build/@vite/client')
    expect(body).toContain('http://localhost:5173/build/resources/js/app.ts')
  })
})

describe('inertia XHR visit', () => {
  test('returns the JSON page object with X-Inertia headers', async () => {
    const res = await build().handle(inertiaReq('/home'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-inertia')).toBe('true')
    expect(res.headers.get('vary')).toBe('X-Inertia')
    const page = (await res.json()) as {
      component: string
      props: Record<string, unknown>
      url: string
    }
    expect(page.component).toBe('Home')
    expect(page.props.name).toBe('Sam')
    expect(page.props.errors).toEqual({}) // errors always shared
    expect(page.url).toBe('/home')
  })
})

describe('asset versioning', () => {
  test('version mismatch → 409 with X-Inertia-Location', async () => {
    const res = await build({ version: 'v2' }).handle(
      inertiaReq('/home', { 'x-inertia-version': 'v1' }),
    )
    expect(res.status).toBe(409)
    expect(res.headers.get('x-inertia-location')).toBe('http://localhost/home')
  })
  test('matching version → 200', async () => {
    const res = await build({ version: 'v2' }).handle(
      inertiaReq('/home', { 'x-inertia-version': 'v2' }),
    )
    expect(res.status).toBe(200)
  })
})

describe('partial reloads', () => {
  test('only requested props are returned; always kept; optional included when asked', async () => {
    const res = await build().handle(
      inertiaReq('/lazy', {
        'x-inertia-partial-component': 'Lazy',
        'x-inertia-partial-data': 'maybe',
      }),
    )
    const page = (await res.json()) as { props: Record<string, unknown> }
    expect(page.props.maybe).toBe('M') // optional, explicitly requested
    expect(page.props.always).toBe('A') // always, kept even in `only`
    expect(page.props.normal).toBeUndefined() // filtered out
  })

  test('optional props are absent on a full visit', async () => {
    const res = await build().handle(inertiaReq('/lazy'))
    const page = (await res.json()) as { props: Record<string, unknown> }
    expect(page.props.normal).toBe('N')
    expect(page.props.always).toBe('A')
    expect(page.props.maybe).toBeUndefined() // optional never on full visit
  })
})

describe('shared props', () => {
  test('Inertia.share merges into every page', async () => {
    Inertia.share('appName', 'Elyvel')
    Inertia.share('user', () => ({ id: 1 }))
    const res = await build().handle(inertiaReq('/home'))
    const page = (await res.json()) as { props: Record<string, unknown> }
    expect(page.props.appName).toBe('Elyvel')
    expect(page.props.user).toEqual({ id: 1 })
  })
})

describe('v2: deferred props', () => {
  const app = () =>
    new Elysia().use(inertia()).get('/posts', () =>
      Inertia.render('Posts', {
        user: 'Sam',
        comments: Inertia.defer(() => ['c1', 'c2']),
        analytics: Inertia.defer(() => ['a1'], 'reports'),
      }))

  test('full visit omits deferred props and advertises them (grouped)', async () => {
    const res = await app().handle(inertiaReq('/posts'))
    const page = (await res.json()) as {
      props: Record<string, unknown>
      deferredProps: Record<string, string[]>
    }
    expect(page.props.user).toBe('Sam')
    expect(page.props.comments).toBeUndefined() // deferred, not in initial payload
    expect(page.deferredProps).toEqual({ default: ['comments'], reports: ['analytics'] })
  })

  test('partial reload resolves the requested deferred prop', async () => {
    const res = await app().handle(
      inertiaReq('/posts', {
        'x-inertia-partial-component': 'Posts',
        'x-inertia-partial-data': 'comments',
      }),
    )
    const page = (await res.json()) as { props: Record<string, unknown> }
    expect(page.props.comments).toEqual(['c1', 'c2'])
    expect(page.props.user).toBeUndefined() // not requested
  })
})

describe('v2: merge props', () => {
  test('merge/deepMerge/prepend + matchOn surface in the page object', async () => {
    const app = new Elysia().use(inertia()).get('/feed', () =>
      Inertia.render('Feed', {
        posts: Inertia.merge(() => [{ id: 1 }]).matchOn('posts.id'),
        chat: Inertia.deepMerge({ messages: [] }),
        alerts: Inertia.merge(['a']).prepend(),
      }))
    const page = (await app.handle(inertiaReq('/feed')).then(r => r.json())) as {
      props: Record<string, unknown>
      mergeProps: string[]
      deepMergeProps: string[]
      prependProps: string[]
      matchPropsOn: string[]
    }
    expect(page.props.posts).toEqual([{ id: 1 }]) // still resolved into props
    expect(page.mergeProps).toEqual(['posts'])
    expect(page.deepMergeProps).toEqual(['chat'])
    expect(page.prependProps).toEqual(['alerts'])
    expect(page.matchPropsOn).toEqual(['posts.id'])
  })
})

describe('v2: history flags', () => {
  test('encryptHistory / clearHistory / preserveFragment set page flags', async () => {
    const app = new Elysia()
      .use(inertia())
      .get('/secure', () =>
        Inertia.render('Secure', {}).encryptHistory().clearHistory().preserveFragment())
    const page = (await app.handle(inertiaReq('/secure')).then(r => r.json())) as Record<
      string,
      unknown
    >
    expect(page.encryptHistory).toBe(true)
    expect(page.clearHistory).toBe(true)
    expect(page.preserveFragment).toBe(true)
  })
})

describe('server-side rendering', () => {
  const ssrApp = () =>
    new Elysia()
      .use(
        inertia({
          ssr: {
            // fake SSR render — stands in for the built Vue bundle
            render: page => ({
              head: ['<title>SSR Home</title>'],
              body: `<div id="app" data-page='${JSON.stringify(page)}'><main>SSR: ${String(page.props.name)}</main></div>`,
            }),
          },
        }),
      )
      .get('/home', () => Inertia.render('Home', { name: 'Sam' }))

  test('first load returns server-rendered markup + ssr head', async () => {
    const res = await ssrApp().handle(new Request('http://localhost/home'))
    const body = await res.text()
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(body).toContain('<title>SSR Home</title>') // ssr head injected
    expect(body).toContain('<main>SSR: Sam</main>') // rendered on the server, no JS needed
    expect(body).toContain('data-page=') // still hydratable
  })

  test('XHR visit is unaffected by SSR (still JSON)', async () => {
    const res = await ssrApp().handle(inertiaReq('/home'))
    expect(res.headers.get('x-inertia')).toBe('true')
    expect(((await res.json()) as { component: string }).component).toBe('Home')
  })
})

describe('Inertia.location', () => {
  test('409 + X-Inertia-Location for XHR, 302 otherwise', async () => {
    const xhr = await build().handle(inertiaReq('/external'))
    expect(xhr.status).toBe(409)
    expect(xhr.headers.get('x-inertia-location')).toBe('https://example.com')

    const plain = await build().handle(new Request('http://localhost/external'))
    expect(plain.status).toBe(302)
    expect(plain.headers.get('location')).toBe('https://example.com')
  })
})
