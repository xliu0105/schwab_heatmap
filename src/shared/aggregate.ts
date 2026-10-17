import type { BaseUniverseId, UniverseId } from './types'
import { etfTicker, isEtfUniverse } from './types'

/**
 * Official index quoted by Schwab for each index map. Maps without one (all US, watchlist,
 * holdings, or an index Schwab doesn't carry) fall back to an estimate from the constituents.
 */
const INDEX_SYMBOL: Partial<Record<BaseUniverseId, string>> = {
  sp500: '$SPX',
  ndx100: '$NDX',
  comp: '$COMPX',
  dow30: '$DJI',
  djt: '$DJT',
  dju: '$DJU',
  bkx: '$BKX'
}

/** The symbol whose own move is "the page's move": the index, or the ETF itself. */
export function benchmarkFor(id: UniverseId): string | undefined {
  return isEtfUniverse(id) ? etfTicker(id) : INDEX_SYMBOL[id as BaseUniverseId]
}

export interface Aggregate {
  /** Percent change of the whole basket over the period. */
  pct: number
  /** Money gained or lost, in the same unit as the values passed in. */
  change: number
  covered: number
  total: number
}

/**
 * Buy-and-hold return of a basket: each item is worth `value` now after moving `pct` over the
 * period, so it was worth value / (1 + pct) at the start. Weighting by market cap, position value
 * or 1 (equal weight) is just a choice of `value`. Items without a change are left out.
 */
export function buyAndHold(items: { value: number | undefined; pct: number | undefined }[]): Aggregate | undefined {
  let now = 0
  let start = 0
  let covered = 0
  for (const { value, pct } of items) {
    if (value === undefined || !(value > 0) || pct === undefined || !Number.isFinite(pct) || pct <= -100) continue
    now += value
    start += value / (1 + pct / 100)
    covered++
  }
  if (!covered || !(start > 0)) return undefined
  return { pct: (now / start - 1) * 100, change: now - start, covered, total: items.length }
}
