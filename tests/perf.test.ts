import { describe, expect, it } from 'vitest'
import { changePct, referenceCloses } from '@shared/perf'

const day = (s: string) => new Date(`${s}T05:00:00Z`).getTime()

describe('referenceCloses', () => {
  const candles = [
    { t: day('2025-10-16'), c: 80 },
    { t: day('2025-12-31'), c: 90 },
    { t: day('2026-01-02'), c: 91 },
    { t: day('2026-09-17'), c: 95 },
    { t: day('2026-10-09'), c: 98 },
    { t: day('2026-10-16'), c: 100 }
  ]
  const now = new Date('2026-10-17T15:00:00Z')
  it('takes the last close on or before each window start', () => {
    const r = referenceCloses(candles, now)
    expect(r.YTD).toBe(90)
    expect(r['1W']).toBe(98)
    expect(r['1M']).toBe(95)
    expect(r['1Y']).toBe(80)
  })
  it('falls back to the earliest close for young listings', () => {
    expect(referenceCloses(candles.slice(2), now)['1Y']).toBe(91)
  })
  it('computes live change against the reference', () => {
    expect(changePct({ symbol: 'X', last: 99 }, { YTD: 90 }, 'YTD')).toBeCloseTo(10)
    expect(changePct({ symbol: 'X', changePct: 1.5 }, undefined, '1D')).toBe(1.5)
    expect(changePct({ symbol: 'X', last: 99 }, undefined, '1M')).toBeUndefined()
  })
})
