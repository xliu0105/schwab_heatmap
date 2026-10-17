import { scaleLinear } from 'd3-scale'
import type { Period } from '@shared/types'

// Red–grey–green diverging steps, at -3…+3 units of the period's scale.
export const STEPS = [
  [-3, '#f23645'],
  [-2, '#b22833'],
  [-1, '#7a2a33'],
  [0, '#3c3f4a'],
  [1, '#1f6a4a'],
  [2, '#089950'],
  [3, '#22c25e']
] as const

export const NO_DATA = '#262a33'

/** Percent change that maps to the strongest color, per period. Longer windows move more. */
export const SCALE: Record<Period, number> = {
  '1D': 3,
  EXT: 3,
  '1W': 6,
  '1M': 10,
  '3M': 15,
  '6M': 20,
  YTD: 30,
  '1Y': 30
}

const unit = scaleLinear<string>()
  .domain(STEPS.map((s) => s[0]))
  .range(STEPS.map((s) => s[1]))
  .clamp(true)

// Interpolating a color string per tile per frame adds up on big maps; 0.01-unit steps are invisible.
const colorCache = new Map<number, string>()

export function colorFor(pct: number | undefined, period: Period): string {
  if (pct === undefined || !Number.isFinite(pct)) return NO_DATA
  const key = Math.round(Math.max(-3, Math.min(3, (pct / SCALE[period]) * 3)) * 100)
  let c = colorCache.get(key)
  if (!c) colorCache.set(key, (c = unit(key / 100)))
  return c
}

/** Legend bucket index (0…6) a change falls in, for legend-hover highlighting. */
export function bucketOf(pct: number | undefined, period: Period): number | undefined {
  if (pct === undefined || !Number.isFinite(pct)) return undefined
  const u = (pct / SCALE[period]) * 3
  return Math.max(0, Math.min(6, Math.round(u) + 3))
}

export function legendLabels(period: Period): string[] {
  const s = SCALE[period] / 3
  return STEPS.map(([u]) => `${u > 0 ? '+' : ''}${+(u * s).toFixed(1)}%`)
}

export const fmtPct = (p: number | undefined) => {
  if (p === undefined || !Number.isFinite(p)) return '—'
  // Values that round to zero print as 0.00%, not "-0.00%".
  if (Math.abs(p) < 0.005) return '0.00%'
  return `${p > 0 ? '+' : ''}${p.toFixed(2)}%`
}
