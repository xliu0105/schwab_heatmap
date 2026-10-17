import { describe, expect, it } from 'vitest'
import { parseSymbolList, searchSymbols, type SymbolEntry } from '@shared/symbolSearch'

const e = (symbol: string, name: string): SymbolEntry => ({ symbol, name, sector: 'X' })
const table = [
  e('APP', 'AppLovin Corporation'),
  e('AAPL', 'Apple Inc.'),
  e('APPN', 'Appian Corporation'),
  e('AAP', 'Advance Auto Parts'),
  e('PINEAPPLE', 'Pineapple Holdings'),
  e('BRK.B', 'Berkshire Hathaway Inc. Class B'),
  e('NVDA', 'NVIDIA Corporation'),
  e('NVDL', 'GraniteShares 2x Long NVDA')
]
const syms = (q: string, limit?: number) => searchSymbols(table, q, limit).map((x) => x.symbol)

describe('searchSymbols', () => {
  it('puts the exact ticker first', () => {
    expect(syms('AAPL')[0]).toBe('AAPL')
    expect(syms('app')[0]).toBe('APP')
  })
  it('ranks ticker prefixes before name matches', () => {
    expect(syms('app')).toEqual(['APP', 'APPN', 'AAPL', 'PINEAPPLE'])
  })
  it('matches words in company names, case-insensitively', () => {
    expect(syms('apple')).toEqual(['AAPL', 'PINEAPPLE'])
    expect(syms('berkshire')).toEqual(['BRK.B'])
  })
  it('understands share-class spellings', () => {
    expect(syms('brk/b')[0]).toBe('BRK.B')
    expect(syms('brk.b')[0]).toBe('BRK.B')
  })
  it('handles empty queries and limits', () => {
    expect(syms('  ')).toEqual([])
    expect(syms('nvd')).toEqual(['NVDA', 'NVDL'])
    expect(syms('nvd', 1)).toEqual(['NVDA'])
  })
})

describe('parseSymbolList', () => {
  it('splits on spaces and commas, normalises and dedupes', () => {
    expect(parseSymbolList('AAPL, msft  TSLA，brk/b aapl')).toEqual(['AAPL', 'MSFT', 'TSLA', 'BRK.B'])
  })
})
