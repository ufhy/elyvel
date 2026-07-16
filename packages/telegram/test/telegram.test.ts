import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { TelegramClient } from '../src/client'
import { setDefaultTelegram, Telegram } from '../src/manager'

// A local fake Telegram Bot API — captures requests so we can assert a real
// round-trip (client → HTTP → server) without hitting api.telegram.org.
const received: { path: string, body: Record<string, unknown> }[] = []
let server: ReturnType<typeof Bun.serve>
let apiBase: string

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      received.push({ path: url.pathname, body: (await req.json()) as Record<string, unknown> })
      return Response.json({ ok: true, result: { message_id: 1 } })
    },
  })
  apiBase = `http://localhost:${server.port}`
})
afterAll(() => server.stop(true))

describe('TelegramClient (live, local fake API)', () => {
  test('sendMessage POSTs to /bot<token>/sendMessage with the right payload', async () => {
    const client = new TelegramClient({ token: 'TESTTOKEN', apiBase })
    const result = await client.sendMessage({ chatId: 4242, text: 'Hello', parseMode: 'HTML' })

    expect(result).toEqual({ message_id: 1 })
    const call = received.at(-1)
    expect(call?.path).toBe('/botTESTTOKEN/sendMessage')
    expect(call?.body).toMatchObject({ chat_id: 4242, text: 'Hello', parse_mode: 'HTML' })
  })

  test('uses defaultChatId when the message omits one', async () => {
    const client = new TelegramClient({ token: 'T', apiBase, defaultChatId: 99 })
    await client.sendMessage('via default chat')
    expect(received.at(-1)?.body).toMatchObject({ chat_id: 99, text: 'via default chat' })
  })

  test('throws without any chat id', async () => {
    const client = new TelegramClient({ token: 'T', apiBase })
    await expect(client.sendMessage('no chat')).rejects.toThrow(/chatId/)
  })

  test('surfaces API errors', async () => {
    // point at a path the fake server answers ok, but simulate ok:false by using a token
    // the server treats normally — instead assert the ok:false branch via a bad response:
    const bad = Bun.serve({
      port: 0,
      fetch: () => Response.json({ ok: false, description: 'Unauthorized' }),
    })
    try {
      const client = new TelegramClient({ token: 'X', apiBase: `http://localhost:${bad.port}` })
      await expect(client.sendMessage({ chatId: 1, text: 'x' })).rejects.toThrow(/Unauthorized/)
    }
    finally {
      bad.stop(true)
    }
  })

  test('Telegram.to(id).message() via the default client', async () => {
    setDefaultTelegram(new TelegramClient({ token: 'FACADE', apiBase }))
    await Telegram.to(7).message('hi there', { disableNotification: true })
    expect(received.at(-1)?.body).toMatchObject({
      chat_id: 7,
      text: 'hi there',
      disable_notification: true,
    })
  })
})
