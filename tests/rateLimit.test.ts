import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter, type Lane } from '../src/main/schwab/rateLimit'

const make = (limit: number, windowMs: number, concurrency = 10, reserves = { refresh: 0, bulk: 0 }) =>
  new RateLimiter(limit, windowMs, concurrency, () => Date.now(), reserves)

const jobs = (lim: RateLimiter, n: number, lane: Lane, log: string[], tag = lane) =>
  Array.from({ length: n }, (_, i) => lim.run(async () => void log.push(`${tag}${i}`), { lane }))

describe('RateLimiter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lets interactive requests burst up to the window limit', async () => {
    const lim = make(3, 1000)
    const log: string[] = []
    const all = jobs(lim, 5, 'interactive', log)
    await vi.advanceTimersByTimeAsync(5)
    expect(log).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(all)
    expect(log).toHaveLength(5)
  })

  it('paces bulk requests evenly instead of bursting', async () => {
    const lim = make(10, 1000)
    const t0 = Date.now()
    const at: number[] = []
    const all = Array.from({ length: 5 }, () => lim.run(async () => void at.push(Date.now() - t0), { lane: 'bulk' }))
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(all)
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(100)
  })

  it('serves lanes in priority order', async () => {
    const lim = make(100, 1000, 1)
    const log: string[] = []
    // Occupy the single slot so everything else queues, then release it.
    let release!: () => void
    const blocker = lim.run(() => new Promise<void>((r) => (release = r)))
    await vi.advanceTimersByTimeAsync(1)
    const all = [...jobs(lim, 2, 'bulk', log), ...jobs(lim, 2, 'refresh', log), ...jobs(lim, 2, 'interactive', log)]
    release()
    await vi.advanceTimersByTimeAsync(2000)
    await Promise.all([blocker, ...all])
    expect(log).toEqual(['interactive0', 'interactive1', 'refresh0', 'refresh1', 'bulk0', 'bulk1'])
  })

  it('keeps reserved slots: bulk leaves 60, refresh leaves 30', async () => {
    const lim = make(110, 60_000, 200, { refresh: 30, bulk: 60 })
    const log: string[] = []
    const bulk = jobs(lim, 200, 'bulk', log)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(log.filter((l) => l.startsWith('bulk')).length).toBeLessThanOrEqual(50)
    const refresh = jobs(lim, 100, 'refresh', log)
    await vi.advanceTimersByTimeAsync(5)
    expect(log.filter((l) => l.startsWith('refresh')).length).toBeGreaterThanOrEqual(30)
    expect(lim.stats().used).toBeLessThanOrEqual(80)
    const interactive = jobs(lim, 30, 'interactive', log)
    await vi.advanceTimersByTimeAsync(5)
    expect(log.filter((l) => l.startsWith('interactive'))).toHaveLength(30)
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    await Promise.all([...bulk, ...refresh, ...interactive])
  })

  it('caps concurrency', async () => {
    const lim = make(1000, 1000, 2)
    let active = 0
    let peak = 0
    const job = () =>
      lim.run(async () => {
        peak = Math.max(peak, ++active)
        await new Promise((r) => setTimeout(r, 50))
        active--
      })
    const all = Promise.all([job(), job(), job(), job()])
    await vi.advanceTimersByTimeAsync(500)
    await all
    expect(peak).toBe(2)
  })

  it('reports queue depth and window usage', async () => {
    const lim = make(2, 1000, 10)
    const log: string[] = []
    const all = [...jobs(lim, 3, 'interactive', log), ...jobs(lim, 1, 'bulk', log)]
    await vi.advanceTimersByTimeAsync(1)
    expect(lim.stats()).toMatchObject({ used: 2, queued: { interactive: 1, refresh: 0, bulk: 1 } })
    await vi.advanceTimersByTimeAsync(5000)
    await Promise.all(all)
  })
})
