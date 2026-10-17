import { auth, AuthError } from '../auth/oauth'
import { RateLimiter } from './rateLimit'

const BASE = 'https://api.schwabapi.com'

// Schwab allows 120 market-data requests per minute; stay a little under it.
// Background sync keeps 20 of those free so switching to a big universe never waits on it.
export const limiter = new RateLimiter(110, 60_000, 6, Date.now, 20)

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** `background` requests (bulk history sync) yield to everything interactive. */
export async function schwabGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
  opts: { background?: boolean } = {}
): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  return limiter.run(async () => {
    let token = await auth.accessToken()
    let refreshed = false
    for (let retry = 0; ; retry++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (res.status === 401 && !refreshed) {
        refreshed = true
        token = await auth.forceRefresh()
        continue
      }
      if (res.status === 401) throw new AuthError('Schwab 授权失效，请重新登录')
      if (res.status === 429 && retry < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (retry + 1)))
        continue
      }
      if (!res.ok) throw new HttpError(res.status, `GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return (await res.json()) as T
    }
  }, opts)
}
