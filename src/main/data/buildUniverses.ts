// Builds the universe files (index members + sector/industry) from Wikipedia and Nasdaq.
// Schwab has no index-membership or sector data, so this is where grouping comes from.
// No Electron imports: used both by `npm run universes` and by the in-app refresh button.
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { normalizeSymbol } from '@shared/symbols'
import type { Constituent } from '@shared/types'
import { classifyNasdaq, OTHER } from '@shared/taxonomy'

const UA = 'schwab-heatmap/0.1 (personal use)'

async function fetchPage(title: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=render`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${title}: HTTP ${res.status}`)
  return res.text()
}

function decode(s: string): string {
  return s
    .replace(/<sup[\s\S]*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTables(html: string): string[][][] {
  const tables: string[][][] = []
  for (const m of html.matchAll(/<table class="wikitable[\s\S]*?<\/table>/g)) {
    const rows: string[][] = []
    for (const r of m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const cells = [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1]))
      if (cells.length) rows.push(cells)
    }
    tables.push(rows)
  }
  return tables
}

/** Picks the largest table whose header has every column in `need`. */
function findTable(html: string, need: RegExp[]): { header: string[]; rows: string[][] } {
  let best: { header: string[]; rows: string[][] } | null = null
  for (const t of parseTables(html)) {
    const header = t[0] ?? []
    if (!need.every((re) => header.some((h) => re.test(h)))) continue
    if (!best || t.length - 1 > best.rows.length) best = { header, rows: t.slice(1) }
  }
  if (!best) throw new Error(`no table with columns ${need.join(', ')}`)
  return best
}

function col(header: string[], re: RegExp): number {
  const i = header.findIndex((h) => re.test(h))
  if (i < 0) throw new Error(`missing column ${re}`)
  return i
}

function extract(html: string, sym: RegExp, name: RegExp): Constituent[] {
  const { header, rows } = findTable(html, [sym, name, /GICS Sector/i, /Sub-Industry/i])
  const [s, n, sec, ind] = [col(header, sym), col(header, name), col(header, /GICS Sector/i), col(header, /Sub-Industry/i)]
  return rows
    .filter((r) => r.length >= header.length - 1 && r[s])
    .map((r) => ({ symbol: normalizeSymbol(r[s]), name: r[n], sector: r[sec], industry: r[ind] }))
}

const words = (s: string) => ` ${s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `

function dowFromNavbox(html: string, sp500: Constituent[]): Constituent[] {
  const i = html.indexOf('UnitedHealth')
  if (i < 0) throw new Error('Dow navbox not found')
  const cell = html.slice(html.lastIndexOf('<td', i), html.indexOf('</td>', i))
  const names = [...cell.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => decode(m[1]))
  const picked = names.map((name) => {
    const find = (needle: string) => sp500.find((c) => words(c.name).includes(words(needle)))
    // Rows come in Wikipedia order, so share-class duplicates resolve to the first class (GOOGL).
    const hit = find(name) ?? find(name.split(' ')[0])
    if (!hit) throw new Error(`Dow member "${name}" not found in S&P 500`)
    return hit
  })
  return [...new Map(picked.map((c) => [c.symbol, c])).values()]
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

async function nasdaqJson<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.nasdaq.com/api/${path}`, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`nasdaq ${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

/** Official members of a Nasdaq-owned index (NDX, COMP, BKX), from the index's weighting page. */
export async function nasdaqIndex(id: string): Promise<{ symbol: string; name: string }[]> {
  // The page is keyed by trade date; weekends and holidays come back empty, so walk back a few days.
  for (let back = 0; back < 7; back++) {
    const d = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
    const res = await fetch('https://indexes.nasdaqomx.com/Index/WeightingData', {
      method: 'POST',
      headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id, tradeDate: `${d}T00:00:00.000`, timeOfDay: 'SOD' })
    })
    if (!res.ok) continue
    const json = (await res.json()) as { aaData?: { Symbol: string; Name: string }[] }
    if (json.aaData?.length) return json.aaData.map((r) => ({ symbol: normalizeSymbol(r.Symbol), name: r.Name }))
  }
  throw new Error(`Nasdaq index ${id}: no weighting data in the last 7 days`)
}

/** Dow Transportation / Utility pages: a table with Company and Ticker columns. */
export function dowFromTickerTable(html: string): { symbol: string; name: string }[] {
  const { header, rows } = findTable(html, [/^Company$/i, /^(Ticker|Symbol)$/i])
  const s = col(header, /^(Ticker|Symbol)$/i)
  const n = col(header, /^Company$/i)
  return rows
    .filter((r) => r[s])
    .map((r) => ({ symbol: normalizeSymbol(r[s].replace(/^[A-Z]+:\s*/, '')), name: r[n] }))
}

interface ScreenerRow {
  symbol: string
  name: string
  lastsale: string
  marketCap: string
  sector: string
  industry: string
}

const num = (s: string) => Number(s.replace(/[$,]/g, '')) || 0

export interface SymbolInfo {
  name: string
  sector: string
  industry: string
  shares?: number
}

export async function buildUniverses(out: string, log: (msg: string) => void = () => {}): Promise<void> {
  mkdirSync(out, { recursive: true })

  const sp500 = extract(await fetchPage('List of S&P 500 companies'), /^Symbol$/i, /^Security$/i)
  const gics = new Map(sp500.map((c) => [c.symbol, c]))

  // Whole-market screener: classification for non-S&P symbols (mapped onto GICS), the
  // "all US companies" list, and share counts so market cap works before Schwab's fundamentals load.
  const screener = await nasdaqJson<{ data: { rows: ScreenerRow[] } }>('screener/stocks?tableonly=true&download=true')
  const info: Record<string, SymbolInfo> = {}
  const unmapped = new Map<string, number>()
  const allus: { c: Constituent; cap: number }[] = []
  for (const r of screener.data.rows) {
    const symbol = normalizeSymbol(r.symbol)
    const price = num(r.lastsale)
    const cap = num(r.marketCap)
    const shares = price > 0 && cap > 0 ? Math.round(cap / price) : undefined
    const g = gics.get(symbol)
    const k = g ? { sector: g.sector, industry: g.industry, mapped: true } : classifyNasdaq(r.sector, r.industry)
    if (!k.mapped) unmapped.set(r.industry, (unmapped.get(r.industry) ?? 0) + 1)
    info[symbol] = { name: g?.name ?? r.name, sector: k.sector, industry: k.industry, shares }
    if (cap > 0) allus.push({ c: { symbol, name: info[symbol].name, sector: k.sector, industry: k.industry }, cap })
  }
  for (const c of sp500) info[c.symbol] ??= { name: c.name, sector: c.sector, industry: c.industry }

  const lookup = ({ symbol, name }: { symbol: string; name: string }): Constituent => {
    const i = info[symbol]
    return { symbol, name: i?.name ?? name, sector: i?.sector ?? OTHER, industry: i?.industry ?? OTHER }
  }

  const ndx = (await nasdaqIndex('NDX')).map(lookup)
  const comp = (await nasdaqIndex('COMP')).map(lookup)
  const bkx = (await nasdaqIndex('BKX')).map(lookup)

  // The Dow Industrials article only lists members by company name (in its navbox).
  const dow = dowFromNavbox(await fetchPage('Dow Jones Industrial Average'), sp500)
  const djt = dowFromTickerTable(await fetchPage('Dow Jones Transportation Average')).map(lookup)
  const dju = dowFromTickerTable(await fetchPage('Dow Jones Utility Average')).map(lookup)
  const djc = [...new Map([...dow, ...djt, ...dju].map((c) => [c.symbol, c])).values()]

  const outputs = [
    ['sp500', sp500, 490],
    ['ndx100', ndx, 95],
    ['dow30', dow, 30],
    ['comp', comp, 2500],
    ['djc', djc, 60],
    ['djt', djt, 20],
    ['dju', dju, 15],
    ['bkx', bkx, 20],
    ['allus', allus.sort((a, b) => b.cap - a.cap).map((a) => a.c), 4000]
  ] as const
  for (const [file, list, min] of outputs)
    if (list.length < min) throw new Error(`${file}: only ${list.length} rows, page layout may have changed`)
  for (const [file, list] of outputs) {
    writeFileSync(resolve(out, `${file}.json`), JSON.stringify(list))
    log(`${file}: ${list.length}, unclassified: ${list.filter((c) => c.sector === OTHER).length}`)
  }
  writeFileSync(resolve(out, 'symbols.json'), JSON.stringify(info))
  log(`symbols: ${Object.keys(info).length}`)
  if (unmapped.size) log(`unmapped Nasdaq industries: ${[...unmapped].map(([k, v]) => `${k || '(blank)'}×${v}`).join(', ')}`)
}
