import { auth, AuthError } from '../auth/oauth'
import { perfLog } from '../perf'
import { RateLimiter, type Lane } from './rateLimit'

const BASE = 'https://api.schwabapi.com'
// A request that hangs (network, proxy) must not hold a concurrency slot forever.
const TIMEOUT_MS = 15_000
const SLOW_QUEUE_MS = 1000

// Schwab allows 120 market-data requests per minute; stay a little under it. Lower lanes leave
// room for higher ones: bulk history sync uses at most 50/min, refreshes at most 80/min, so
// whatever you're waiting on (hover chart, a map's first load) always has 30–60 slots.
// Up to 10 requests in flight: a big map's ~30 quote batches finish in ~3 round trips, not 5.
export const limiter = new RateLimiter(110, 60_000, 10, Date.now, { refresh: 30, bulk: 60 })

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function schwabGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
  opts: { lane?: Lane } = {}
): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`
  const lane = opts.lane ?? 'interactive'
  const queuedAt = Date.now()
  return limiter.run(async () => {
    const waited = Date.now() - queuedAt
    const stats = waited > SLOW_QUEUE_MS ? limiter.stats() : undefined
    try {
      let token = await auth.accessToken()
      let refreshed = false
      for (let retry = 0; ; retry++) {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
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
    } finally {
      if (stats)
        perfLog('slowRequest', {
          lane,
          path,
          waitedMs: waited,
          totalMs: Date.now() - queuedAt,
          used: stats.used,
          active: stats.active,
          qInteractive: stats.queued.interactive,
          qRefresh: stats.queued.refresh,
          qBulk: stats.queued.bulk
        })
    }
  }, { lane })
}
