import type { Period, Quote, RefTable } from './types'

const DAY = 86_400_000

/** Start-of-window timestamp for a long period, measured back from `now`. */
export function periodStart(period: Period, now: Date): number | undefined {
  const d = new Date(now)
  switch (period) {
    case '1W':
      return now.getTime() - 7 * DAY
    case '1M':
      d.setMonth(d.getMonth() - 1)
      return d.getTime()
    case '3M':
      d.setMonth(d.getMonth() - 3)
      return d.getTime()
    case '6M':
      d.setMonth(d.getMonth() - 6)
      return d.getTime()
    case '1Y':
      d.setFullYear(d.getFullYear() - 1)
      return d.getTime()
    case 'YTD':
      // Last close of the previous year: anything on or before Dec 31.
      return new Date(now.getFullYear() - 1, 11, 31, 23, 59).getTime()
    default:
      return undefined
  }
}

export const LONG_PERIODS: Period[] = ['1W', '1M', '3M', '6M', 'YTD', '1Y']

/** Picks, for each long period, the last daily close on or before that period's start. */
export function referenceCloses(candles: { t: number; c: number }[], now: Date): Partial<Record<Period, number>> {
  const out: Partial<Record<Period, number>> = {}
  for (const p of LONG_PERIODS) {
    const start = periodStart(p, now)!
    let ref: number | undefined
    for (const k of candles) {
      if (k.t > start) break
      ref = k.c
    }
    // Younger listings: fall back to the first close we have, like a since-IPO change.
    out[p] = ref ?? candles[0]?.c
  }
  return out
}

export function changePct(q: Quote | undefined, refs: RefTable[string] | undefined, period: Period): number | undefined {
  if (!q) return undefined
  if (period === '1D') return q.changePct
  if (period === 'EXT') return q.extPct
  const ref = refs?.[period]
  return ref && q.last ? (q.last / ref - 1) * 100 : undefined
}
