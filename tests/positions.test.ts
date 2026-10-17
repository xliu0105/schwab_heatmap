import { describe, expect, it } from 'vitest'
import { positionsToConstituents } from '@shared/positions'

const describeP = (p: { symbol: string }) => ({ symbol: p.symbol, name: p.symbol, sector: 'X', industry: 'Y' })

describe('positionsToConstituents', () => {
  it('weights positions by their share of the portfolio', () => {
    const cs = positionsToConstituents(
      [
        { symbol: 'AAPL', marketValue: 7500, quantity: 30 },
        { symbol: 'TINY', marketValue: 2500, quantity: 100 }
      ],
      describeP
    )
    expect(cs.map((c) => c.weight)).toEqual([75, 25])
  })
  it('counts shorts by absolute size and sums to 100', () => {
    const cs = positionsToConstituents(
      [
        { symbol: 'LONG', marketValue: 3000, quantity: 10 },
        { symbol: 'SHORT', marketValue: -1000, quantity: -5 }
      ],
      describeP
    )
    expect(cs.map((c) => c.weight)).toEqual([75, 25])
    expect(cs.reduce((s, c) => s + c.weight!, 0)).toBeCloseTo(100)
  })
  it('handles an all-zero portfolio without dividing by zero', () => {
    const cs = positionsToConstituents([{ symbol: 'A', marketValue: 0, quantity: 0 }], describeP)
    expect(cs[0].weight).toBe(0)
  })
})

import { liveValue, mergePositions } from '@shared/positions'

describe('mergePositions', () => {
  it('adds values and net shares across accounts, skipping non-stock assets', () => {
    const ps = mergePositions([
      { securitiesAccount: { positions: [{ instrument: { symbol: 'AAPL', assetType: 'EQUITY' }, marketValue: 1000, longQuantity: 4 }] } },
      {
        securitiesAccount: {
          positions: [
            { instrument: { symbol: 'AAPL', assetType: 'EQUITY' }, marketValue: 500, longQuantity: 2 },
            { instrument: { symbol: 'BRK/B', assetType: 'EQUITY' }, marketValue: -900, shortQuantity: 2 },
            { instrument: { symbol: 'AAPL  261218C00250000', assetType: 'OPTION' }, marketValue: 300, longQuantity: 1 }
          ]
        }
      }
    ])
    expect(ps).toEqual([
      { symbol: 'AAPL', assetType: 'EQUITY', marketValue: 1500, quantity: 6 },
      { symbol: 'BRK.B', assetType: 'EQUITY', marketValue: -900, quantity: -2 }
    ])
  })
})

describe('liveValue', () => {
  const c = { symbol: 'AAPL', name: '', sector: '', industry: '', value: 1000, shares: 4 }
  it('tracks the live price', () => {
    expect(liveValue(c, { symbol: 'AAPL', last: 260 })).toBe(1040)
  })
  it('uses the absolute value for shorts', () => {
    expect(liveValue({ ...c, shares: -4 }, { symbol: 'AAPL', last: 260 })).toBe(1040)
  })
  it('falls back to the loaded value without a price', () => {
    expect(liveValue(c, undefined)).toBe(1000)
    expect(liveValue({ ...c, shares: undefined }, { symbol: 'AAPL', last: 260 })).toBe(1000)
  })
})

import { holdingsChanged, liveDayPL } from '@shared/positions'

describe('day P/L', () => {
  it('sums Schwab day P/L across accounts', () => {
    const ps = mergePositions([
      { securitiesAccount: { positions: [{ instrument: { symbol: 'AAPL', assetType: 'EQUITY' }, marketValue: 1000, longQuantity: 4, currentDayProfitLoss: 12.5 }] } },
      { securitiesAccount: { positions: [{ instrument: { symbol: 'AAPL', assetType: 'EQUITY' }, marketValue: 500, longQuantity: 2, currentDayProfitLoss: -2.5 }] } }
    ])
    expect(ps[0].dayPL).toBe(10)
  })
  it('keeps day P/L live as the price moves after the refresh', () => {
    // 4 shares worth 1000 (=$250) at refresh with +$20 today; price now $255 → +$20 more.
    const c = { symbol: 'AAPL', name: '', sector: '', industry: '', value: 1000, shares: 4, dayPL: 20 }
    expect(liveDayPL(c, { symbol: 'AAPL', last: 255 })).toBeCloseTo(40)
    expect(liveDayPL({ ...c, shares: -4, dayPL: -20 }, { symbol: 'AAPL', last: 255 })).toBeCloseTo(-40)
    expect(liveDayPL(c, undefined)).toBe(20)
    expect(liveDayPL({ ...c, dayPL: undefined }, { symbol: 'AAPL', last: 255 })).toBeUndefined()
  })
})

describe('holdingsChanged', () => {
  it('flags new or closed positions but not size changes', () => {
    const a = [{ symbol: 'AAPL' }, { symbol: 'NVDA' }]
    expect(holdingsChanged(a, [{ symbol: 'NVDA' }, { symbol: 'AAPL' }])).toBe(false)
    expect(holdingsChanged(a, [{ symbol: 'AAPL' }])).toBe(true)
    expect(holdingsChanged(a, [{ symbol: 'AAPL' }, { symbol: 'TSLA' }])).toBe(true)
  })
})

import { holdingsDay } from '@shared/positions'

describe('holdingsDay', () => {
  it('returns day P/L over the value at the start of the day', () => {
    const cs = [
      { symbol: 'A', name: '', sector: '', industry: '', value: 1100, shares: 10, dayPL: 100 },
      { symbol: 'B', name: '', sector: '', industry: '', value: 900, shares: 9, dayPL: -50 }
    ]
    const r = holdingsDay(cs, new Map())!
    expect(r.change).toBe(50)
    expect(r.pct).toBeCloseTo((50 / (2000 - 50)) * 100)
  })
  it('gives up without Schwab day P/L', () => {
    expect(holdingsDay([{ symbol: 'A', name: '', sector: '', industry: '', value: 100 }], new Map())).toBeUndefined()
  })
})
