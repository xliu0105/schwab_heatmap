import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const disk = new Map<string, unknown>()
const fetched: string[] = []
vi.mock('../src/main/storage', () => ({
  readJson: (name: string, fallback: unknown) => (disk.has(name) ? structuredClone(disk.get(name)) : fallback),
  writeJson: (name: string, v: unknown) => void disk.set(name, structuredClone(v))
}))
vi.mock('../src/main/schwab/market', () => ({
  getDailyHistory: async (s: string) => {
    fetched.push(s)
    return [{ t: Date.parse('2026-10-20T04:00:00Z'), c: 1 }]
  },
  getIntraday: async () => []
}))

const { HistoryCache } = await import('../src/main/data/history')

const bar = (day: string, c: number) => ({ t: Date.parse(`${day}T04:00:00Z`), c })
const EVENING = Date.parse('2026-10-20T22:00:00Z') // Tuesday after the close
const dayOld = (c: number) => ({ fetchedAt: Date.parse('2026-10-19T21:30:00Z'), candles: [bar('2026-10-16', c - 1), bar('2026-10-19', c)] })
const quote = (symbol: string, prevClose: number, regularLast: number) => [symbol, { symbol, prevClose, regularLast }] as const

describe('HistoryCache.fill', () => {
  beforeEach(() => {
    disk.clear()
    fetched.length = 0
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(EVENING)
  })
  afterEach(() => vi.useRealTimers())

  it('patches day-old histories from quotes and only fetches the ones it cannot', async () => {
    disk.set('history/AAPL.json', dayOld(100))
    disk.set('history/SPLT.json', dayOld(100)) // quote says prior close was 50 → adjusted prices
    const h = new HistoryCache()
    const seen: string[] = []
    h.fill(['AAPL', 'SPLT', 'NEW'], (s) => seen.push(s), new Map([quote('AAPL', 100, 103), quote('SPLT', 50, 51)]))
    await vi.waitFor(() => expect(fetched.sort()).toEqual(['NEW', 'SPLT']))
    expect((disk.get('history/AAPL.json') as { candles: { c: number }[] }).candles.at(-1)!.c).toBe(103)
    expect(seen.sort()).toEqual(['AAPL', 'NEW', 'SPLT'])
  })

  it('reports progress for the universe on screen only', async () => {
    const h = new HistoryCache()
    const progress: { done: number; total: number }[] = []
    h.on('progress', (p) => progress.push(p))
    h.fill(['A', 'B'], () => {})
    await vi.waitFor(() => expect(progress.at(-1)).toEqual({ done: 2, total: 2 }))
  })
})
