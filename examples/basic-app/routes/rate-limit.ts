import { RateLimiter, route } from '@elysia-ravel/core'

/**
 * Rate limiting demo. `throttle:api` / `throttle:login` reference named limiters
 * (see app/rate-limits.ts). `/otp` shows the programmatic facade: RateLimiter.attempt
 * runs the action only while under the limit, else returns 429.
 */
export default route()
  .get('/throttled', () => ({ ok: true }), { middleware: 'throttle:api' })
  .get('/login-attempt', () => ({ ok: true }), { middleware: 'throttle:login' })
  // biome-ignore lint/suspicious/noExplicitAny: derived request + status
  .post('/otp', async ({ request, status }: any) => {
    const ip = request.headers.get('x-forwarded-for') ?? 'global'
    const sent = await RateLimiter.attempt(`otp:${ip}`, 2, () => ({ sent: true }), 60)
    if (sent === false) {
      const seconds = await RateLimiter.availableIn(`otp:${ip}`)
      return status(429, { message: `Too many OTP requests. Try again in ${seconds}s.` })
    }
    return sent
  })
