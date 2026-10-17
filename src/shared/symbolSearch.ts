import { normalizeSymbol } from './symbols'

export interface SymbolEntry {
  symbol: string
  name: string
  sector: string
}

/**
 * Ranks symbols for a type-ahead: exact ticker, ticker prefix, a word in the company name starting
 * with the query, then the name merely containing it. Ties go to shorter, then alphabetical tickers.
 */
export function searchSymbols(entries: SymbolEntry[], query: string, limit = 20): SymbolEntry[] {
  const q = query.trim()
  if (!q) return []
  const sym = normalizeSymbol(q)
  const text = q.toLowerCase()
  const scored: { e: SymbolEntry; rank: number }[] = []
  for (const e of entries) {
    const name = e.name.toLowerCase()
    let rank = -1
    if (e.symbol === sym) rank = 0
    else if (e.symbol.startsWith(sym)) rank = 1
    else if (name.startsWith(text) || name.includes(` ${text}`)) rank = 2
    else if (text.length >= 3 && name.includes(text)) rank = 3
    if (rank >= 0) scored.push({ e, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.e.symbol.length - b.e.symbol.length || a.e.symbol.localeCompare(b.e.symbol))
  return scored.slice(0, limit).map((s) => s.e)
}

/** Splits pasted text like "AAPL, msft  TSLA" into clean tickers. */
export function parseSymbolList(text: string): string[] {
  return [...new Set(text.split(/[\s,，;；]+/).map(normalizeSymbol).filter(Boolean))]
}
