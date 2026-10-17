import { describe, expect, it } from 'vitest'
import { benchmarkFor, buyAndHold } from '@shared/aggregate'

describe('buyAndHold', () => {
  it('matches a hand-computed cap-weighted move', () => {
    // 300 now after +10% → 272.73 at start; 100 now after −10% → 111.11 at start.
    const r = buyAndHold([
      { value: 300, pct: 10 },
      { value: 100, pct: -10 }
    ])!
    const start = 300 / 1.1 + 100 / 0.9
    expect(r.pct).toBeCloseTo((400 / start - 1) * 100, 9)
    expect(r.change).toBeCloseTo(400 - start, 9)
  })
  it('gives the equal-weight return when every value is 1', () => {
    const r = buyAndHold([
      { value: 1, pct: 10 },
      { value: 1, pct: -10 }
    ])!
    expect(r.pct).toBeCloseTo((2 / (1 / 1.1 + 1 / 0.9) - 1) * 100, 9)
  })
  it('skips items without data and reports coverage', () => {
    const r = buyAndHold([
      { value: 100, pct: 5 },
      { value: 100, pct: undefined },
      { value: undefined, pct: 3 }
    ])!
    expect(r.pct).toBeCloseTo(5)
    expect([r.covered, r.total]).toEqual([1, 3])
  })
  it('never divides by zero', () => {
    expect(buyAndHold([{ value: 100, pct: -100 }])).toBeUndefined()
    expect(buyAndHold([])).toBeUndefined()
  })
})

describe('benchmarkFor', () => {
  it('uses the index for index maps and the fund itself for ETFs', () => {
    expect(benchmarkFor('sp500')).toBe('$SPX')
    expect(benchmarkFor('etf:SMH')).toBe('SMH')
    expect(benchmarkFor('allus')).toBeUndefined()
    expect(benchmarkFor('djc')).toBeUndefined()
  })
})
