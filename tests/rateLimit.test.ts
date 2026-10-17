import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from '../src/main/schwab/rateLimit'

const make = (limit: number, windowMs: number, concurrency = 10, reserve = 0) =>
  new RateLimiter(limit, windowMs, concurrency, () => Date.now(), reserve)

describe('RateLimiter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lets foreground requests burst up to the window limit', async () => {
    const lim = make(3, 1000)
    const started: number[] = []
    const jobs = Array.from({ length: 5 }, (_, i) => lim.run(async () => void started.push(i)))
    await vi.advanceTimersByTimeAsync(5)
    expect(started).toEqual([0, 1, 2])
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(jobs)
    expect(started).toEqual([0, 1, 2, 3, 4])
  })

  it('paces background requests evenly instead of bursting', async () => {
    const lim = make(10, 1000)
    const t0 = Date.now()
    const at: number[] = []
    const jobs = Array.from({ length: 5 }, () => lim.run(async () => void at.push(Date.now() - t0), { background: true }))
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(jobs)
    expect(at).toHaveLength(5)
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(100)
  })

  it('starts foreground work ahead of queued background work', async () => {
    const lim = make(10, 1000)
    const order: string[] = []
    const bg = Array.from({ length: 5 }, (_, i) => lim.run(async () => void order.push(`bg${i}`), { background: true }))
    await vi.advanceTimersByTimeAsync(10)
    const fg = lim.run(async () => void order.push('fg'))
    await vi.advanceTimersByTimeAsync(10)
    expect(order).toEqual(['bg0', 'fg'])
    await vi.advanceTimersByTimeAsync(2000)
    await Promise.all([...bg, fg])
  })

  it('keeps reserved slots free for foreground requests', async () => {
    const lim = make(10, 1000, 10, 4)
    const order: string[] = []
    const bg = Array.from({ length: 10 }, (_, i) => lim.run(async () => void order.push(`bg${i}`), { background: true }))
    await vi.advanceTimersByTimeAsync(950)
    // 10/window with 4 reserved: background stops at 6 even though its pace would allow more.
    expect(order).toHaveLength(6)
    const fg = Array.from({ length: 4 }, (_, i) => lim.run(async () => void order.push(`fg${i}`)))
    await vi.advanceTimersByTimeAsync(1)
    expect(order.slice(6)).toEqual(['fg0', 'fg1', 'fg2', 'fg3'])
    await vi.advanceTimersByTimeAsync(3000)
    await Promise.all([...bg, ...fg])
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
})
