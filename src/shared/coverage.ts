/** Share of symbols we already hold a price for; at or above `EARLY_SHOW_COVERAGE` a map can be
 *  drawn from memory right away and refreshed afterwards. */
export const EARLY_SHOW_COVERAGE = 0.9

export function priceCoverage(symbols: string[], hasPrice: (s: string) => boolean): number {
  if (!symbols.length) return 0
  let n = 0
  for (const s of symbols) if (hasPrice(s)) n++
  return n / symbols.length
}

/**
 * Whether a universe switch may show remembered prices right away. Off by default: a universe
 * stops streaming when you leave it, so its remembered prices can be minutes old.
 */
export function shouldShowEarly(instantSwitch: boolean, coverage: number): boolean {
  return instantSwitch && coverage >= EARLY_SHOW_COVERAGE
}
