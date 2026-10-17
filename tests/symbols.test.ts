import { describe, expect, it } from 'vitest'
import { fromSchwab, normalizeSymbol, toSchwab } from '@shared/symbols'

describe('symbols', () => {
  it('normalizes share-class separators to a dot', () => {
    expect(normalizeSymbol(' brk-b ')).toBe('BRK.B')
    expect(normalizeSymbol('BF/B')).toBe('BF.B')
    expect(normalizeSymbol('AAPL')).toBe('AAPL')
  })
  it('round-trips through the Schwab form', () => {
    expect(toSchwab('BRK.B')).toBe('BRK/B')
    expect(fromSchwab('BRK/B')).toBe('BRK.B')
  })
})

import { etfTicker, etfUniverse, isEtfUniverse } from '@shared/types'

describe('ETF universe ids', () => {
  it('round-trips tickers through ids', () => {
    expect(etfUniverse('SMH')).toBe('etf:SMH')
    expect(isEtfUniverse('etf:SMH')).toBe(true)
    expect(isEtfUniverse('sp500')).toBe(false)
    expect(etfTicker('etf:QQQM')).toBe('QQQM')
  })
})
