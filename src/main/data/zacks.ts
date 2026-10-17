// Parses Zacks' ETF holdings page (no Electron imports, so it is unit-testable).
import { normalizeSymbol } from '@shared/symbols'

export interface Holding {
  symbol: string
  name: string
  /** Percent of the fund, e.g. 19.52. */
  weight: number
  /** True when Zacks links the row to a stock page; plain-text rows may be futures or cash. */
  linked: boolean
}

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()

const ACRONYMS = new Set(['SPDR', 'MSCI', 'FTSE', 'NYSE', 'REIT', 'ESG', 'USD'])

// "INVESCO NASDAQ 100 ETF" → "Invesco Nasdaq 100 ETF"; short words, numbers, S&P and acronyms stay.
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length <= 3 || /[\d&]/.test(w) || ACRONYMS.has(w.toUpperCase()) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ')
}

export function parseZacksHoldings(html: string): { name?: string; holdings: Holding[] } {
  const title = /<title>\s*([^<]*?)\s*<\/title>/i.exec(html)?.[1]
  const name = title ? /^[A-Z.]+ - (.+?) - Holdings/i.exec(strip(title))?.[1] : undefined
  const data = /etf_holdings\.formatted_data\s*=\s*(\[[\s\S]*?\]);\s*\n/.exec(html)?.[1]
  if (!data) return { name: name && titleCase(name), holdings: [] }
  const rows = JSON.parse(data) as string[][]
  const holdings: Holding[] = []
  for (const r of rows) {
    const [nameCell = '', symCell = '', , weightCell = ''] = r
    const rel = /rel="([^"]+)"/.exec(symCell)?.[1]
    const symbol = normalizeSymbol(rel ?? strip(symCell))
    const weight = Number(strip(weightCell).replace(/,/g, ''))
    if (!symbol || !Number.isFinite(weight)) continue
    // Truncated names carry the full one in a title attribute.
    const full = /title="([^"]+)"/.exec(nameCell)?.[1]
    holdings.push({ symbol, name: strip(full ?? nameCell), weight, linked: Boolean(rel) })
  }
  return { name: name && titleCase(name), holdings }
}
