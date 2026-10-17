import type { Constituent, Quote } from './types'
import type { Aggregate } from './aggregate'
import { fromSchwab } from './symbols'

export interface PositionValue {
  symbol: string
  /** Signed: short positions come back negative. */
  marketValue: number
  /** Net shares: long minus short. */
  quantity: number
  /** Today's P/L in dollars as Schwab reports it (uses actual fill prices for today's trades). */
  dayPL?: number
}

export interface Position extends PositionValue {
  assetType: string
}

export interface RawAccount {
  securitiesAccount?: {
    positions?: {
      instrument?: { symbol?: string; assetType?: string }
      marketValue?: number
      longQuantity?: number
      shortQuantity?: number
      currentDayProfitLoss?: number
    }[]
  }
}

/** Equity and ETF positions across all accounts, merged by symbol (values and shares add up). */
export function mergePositions(accounts: RawAccount[]): Position[] {
  const merged = new Map<string, Position>()
  for (const a of accounts)
    for (const p of a.securitiesAccount?.positions ?? []) {
      const type = p.instrument?.assetType ?? ''
      const sym = p.instrument?.symbol
      if (!sym || (type !== 'EQUITY' && type !== 'COLLECTIVE_INVESTMENT')) continue
      const symbol = fromSchwab(sym)
      const prev = merged.get(symbol)
      merged.set(symbol, {
        symbol,
        assetType: type,
        marketValue: (prev?.marketValue ?? 0) + (p.marketValue ?? 0),
        quantity: (prev?.quantity ?? 0) + (p.longQuantity ?? 0) - (p.shortQuantity ?? 0),
        dayPL: p.currentDayProfitLoss === undefined && prev?.dayPL === undefined ? undefined : (prev?.dayPL ?? 0) + (p.currentDayProfitLoss ?? 0)
      })
    }
  return [...merged.values()]
}

/**
 * Holdings as weighted constituents: each position's share of the portfolio, in percent, by
 * absolute value so a short still gets an area proportional to its size.
 */
export function positionsToConstituents<P extends PositionValue>(positions: P[], describe: (p: P) => Constituent): Constituent[] {
  const total = positions.reduce((sum, p) => sum + Math.abs(p.marketValue || 0), 0)
  return positions.map((p) => {
    const value = Math.abs(p.marketValue || 0)
    return { ...describe(p), value, shares: p.quantity, dayPL: p.dayPL, weight: total > 0 ? (value / total) * 100 : 0 }
  })
}

/**
 * A position's current worth: shares × live price, so it tracks the market like thinkorswim;
 * falls back to the value Schwab reported at load when there's no price yet.
 */
export function liveValue(c: Constituent, q: Quote | undefined): number | undefined {
  return c.shares && q?.last ? Math.abs(c.shares * q.last) : c.value
}

/**
 * Today's P/L kept live between position refreshes: Schwab's figure at fetch time, plus how much
 * the position's value has moved since (shares × price now − value then, both signed).
 */
export function liveDayPL(c: Constituent, q: Quote | undefined): number | undefined {
  if (c.dayPL === undefined) return undefined
  if (!c.shares || !q?.last || c.value === undefined) return c.dayPL
  const signedThen = Math.sign(c.shares) * c.value
  return c.dayPL + (c.shares * q.last - signedThen)
}

/** Whether a refreshed position list changes which stocks are held (vs. only sizes/values). */
export function holdingsChanged(before: { symbol: string }[], after: { symbol: string }[]): boolean {
  if (before.length !== after.length) return true
  const set = new Set(before.map((c) => c.symbol))
  return after.some((c) => !set.has(c.symbol))
}

/**
 * Today's portfolio move from Schwab's own day P/L, which uses actual fill prices for positions
 * opened today (an estimate from the stocks' daily % would count the move before you bought).
 */
export function holdingsDay(cs: Constituent[], quotes: Map<string, Quote>): Aggregate | undefined {
  let now = 0
  let change = 0
  let covered = 0
  for (const c of cs) {
    const v = liveValue(c, quotes.get(c.symbol))
    const pl = liveDayPL(c, quotes.get(c.symbol))
    if (v === undefined || pl === undefined) continue
    now += v
    change += pl
    covered++
  }
  if (!covered || !(now - change > 0)) return undefined
  return { pct: (change / (now - change)) * 100, change, covered, total: cs.length }
}
