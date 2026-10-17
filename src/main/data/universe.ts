import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { etfTicker, FILE_UNIVERSES, isEtfUniverse, type BaseUniverseId, type Constituent, type UniverseId } from '@shared/types'
import { getEtf } from './etf'
import { positionsToConstituents } from '@shared/positions'
import { FUNDS, OTHER } from '@shared/taxonomy'
import { settings } from '../settings'
import { getPositions } from '../schwab/market'
import { resourcePath } from '../storage'
import { buildUniverses, type SymbolInfo } from './buildUniverses'
import { searchSymbols, type SymbolEntry } from '@shared/symbolSearch'

// A refreshed copy in userData wins over the snapshot bundled with the app.
const userDir = () => join(app.getPath('userData'), 'universes')

function readUniverseFile<T>(name: string): T {
  const user = join(userDir(), name)
  const file = existsSync(user) ? user : resourcePath('universes', name)
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

let symbolInfo: Record<string, SymbolInfo> | undefined
export function symbolTable(): Record<string, SymbolInfo> {
  symbolInfo ??= readUniverseFile<Record<string, SymbolInfo>>('symbols.json')
  return symbolInfo
}

let entries: { table: Record<string, SymbolInfo>; list: SymbolEntry[] } | undefined

/** Type-ahead over every listed US stock; the flat list is rebuilt when the table is refreshed. */
export function findSymbols(query: string): SymbolEntry[] {
  const table = symbolTable()
  if (entries?.table !== table)
    entries = { table, list: Object.entries(table).map(([symbol, i]) => ({ symbol, name: i.name, sector: i.sector })) }
  return searchSymbols(entries.list, query)
}

function describe(symbol: string, fallbackSector = OTHER): Constituent {
  const i = symbolTable()[symbol]
  return i
    ? { symbol, name: i.name, sector: i.sector, industry: i.industry }
    : { symbol, name: symbol, sector: fallbackSector, industry: fallbackSector }
}

/** An ETF's stocks, weighted. Rows Zacks doesn't link (futures, cash) only stay if they're known stocks. */
async function loadEtf(ticker: string): Promise<Constituent[]> {
  const { holdings } = await getEtf(ticker)
  const table = symbolTable()
  const bySymbol = new Map<string, Constituent>()
  for (const h of holdings) {
    if (!h.linked && !table[h.symbol]) continue
    const prev = bySymbol.get(h.symbol)
    if (prev) prev.weight = (prev.weight ?? 0) + h.weight
    else {
      const c = describe(h.symbol)
      bySymbol.set(h.symbol, { ...c, name: table[h.symbol] ? c.name : h.name, weight: h.weight })
    }
  }
  return [...bySymbol.values()]
}

export async function loadUniverse(id: UniverseId): Promise<Constituent[]> {
  if (isEtfUniverse(id)) return loadEtf(etfTicker(id))
  if (FILE_UNIVERSES.includes(id as BaseUniverseId)) return readUniverseFile<Constituent[]>(`${id}.json`)
  if (id === 'watchlist') return settings.get().watchlist.map((s) => describe(s))
  // Sized by position value (weight = share of the portfolio), not by company market cap.
  return positionsToConstituents(await getPositions(), (p) => {
    const c = describe(p.symbol)
    return c.sector === OTHER && p.assetType === 'COLLECTIVE_INVESTMENT' ? { ...c, sector: FUNDS, industry: 'ETF' } : c
  })
}

export async function refreshUniverses(): Promise<void> {
  await buildUniverses(userDir())
  symbolInfo = undefined
}
