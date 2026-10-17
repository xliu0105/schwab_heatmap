// Synthetic quotes for HEATMAP_DEMO=1, so the UI can be exercised without a Schwab login.
import type { Constituent, Quote, RefTable } from '@shared/types'
import { LONG_PERIODS } from '@shared/perf'
import type { SymbolInfo } from './buildUniverses'

export const demoEnabled = () => process.env.HEATMAP_DEMO === '1'

// Deterministic per symbol so the map looks the same between runs.
function rand(seed: string): () => number {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h >>>= 0) % 10000) / 10000
  }
}

export function demoData(constituents: Constituent[], info: Record<string, SymbolInfo>): { quotes: Quote[]; refs: RefTable } {
  const sectorDrift = new Map<string, number>()
  const quotes: Quote[] = []
  const refs: RefTable = {}
  for (const c of constituents) {
    const r = rand(c.symbol)
    if (!sectorDrift.has(c.sector)) sectorDrift.set(c.sector, (rand(c.sector)() - 0.5) * 2.4)
    const last = 20 + r() * 400
    const changePct = sectorDrift.get(c.sector)! + (r() - 0.5) * 4
    const shares = info[c.symbol]?.shares ?? 2e8 + r() * 1e9
    quotes.push({
      symbol: c.symbol,
      last,
      prevClose: last / (1 + changePct / 100),
      change: last - last / (1 + changePct / 100),
      changePct,
      extPct: (r() - 0.5) * 1.5,
      volume: Math.round(1e6 + r() * 3e7),
      marketCap: shares * last
    })
    refs[c.symbol] = Object.fromEntries(LONG_PERIODS.map((p, i) => [p, last / (1 + ((r() - 0.45) * 8 * (i + 1)) / 100)]))
  }
  return { quotes, refs }
}

/** Nudges a few random prices, like a quiet stream. */
export function demoTick(quotes: Map<string, Quote>): Quote[] {
  const all = [...quotes.values()]
  const out: Quote[] = []
  for (let i = 0; i < Math.min(25, all.length); i++) {
    const q = all[Math.floor(Math.random() * all.length)]
    const last = q.last! * (1 + (Math.random() - 0.5) * 0.002)
    const changePct = q.prevClose ? (last / q.prevClose - 1) * 100 : q.changePct
    out.push({ ...q, last, changePct })
  }
  return out
}
