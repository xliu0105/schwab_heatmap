import type { Candle, Quote } from './types'
import { lastMarketClose, nextOpenAfter, previousClose, sessionDate } from './marketTime'

export interface HistoryEntry {
  fetchedAt: number
  /** Last full pricehistory fetch; quote patches keep it, so a periodic full refresh still happens. */
  fullAt?: number
  candles: Candle[]
}

/** Quote patches can't see split adjustments in every case, so refetch fully at least this often. */
export const FULL_REFRESH_MS = 7 * 86_400_000

const TOLERANCE = 0.005
const HOUR = 3_600_000
const near = (a: number | undefined, b: number | undefined) => !!a && !!b && Math.abs(a / b - 1) <= TOLERANCE

/**
 * Brings a one-session-old daily history up to date from a batch quote instead of a pricehistory
 * request. Which quote field holds the latest close depends on the clock: until the next session
 * opens, the regular-session last price is that close; once it has opened, the previous-close
 * field is. When the quote still shows the close before that, it's checked against the cache to
 * catch price adjustments (splits). Returns undefined when it can't safely patch.
 */
export function patchFromQuote(entry: HistoryEntry | undefined, q: Quote | undefined, now: number): HistoryEntry | undefined {
  if (!entry?.candles.length || !q) return undefined
  const close = lastMarketClose(now)
  if (entry.fetchedAt >= close) return entry
  if (now - (entry.fullAt ?? entry.fetchedAt) > FULL_REFRESH_MS) return undefined

  const beforeNextOpen = now < nextOpenAfter(close)
  let latest: number | undefined
  if (beforeNextOpen) {
    latest = q.regularLast
    // The previous-close field may not have rolled yet; if it hasn't, it must match our last bar.
    const lastBar = entry.candles[entry.candles.length - 1]
    const unrolled = !near(q.prevClose, q.regularLast)
    if (unrolled && sessionDate(lastBar.t) === sessionDate(previousClose(close)) && !near(q.prevClose, lastBar.c)) return undefined
  } else latest = q.prevClose
  if (!latest) return undefined

  const latestDay = sessionDate(close)
  const prevDay = sessionDate(previousClose(close))
  const candles = entry.candles
  const last = candles[candles.length - 1]
  const lastDay = sessionDate(last.t)
  const keep = { fetchedAt: now, fullAt: entry.fullAt ?? entry.fetchedAt }
  // Fetched during that session: its bar is partial, so replace it.
  if (lastDay === latestDay) return { ...keep, candles: [...candles.slice(0, -1), { t: last.t, c: latest }] }
  if (lastDay !== prevDay) return undefined
  // A 16:00 New York close minus 16 hours is that session's midnight, like Schwab's daily stamps.
  return { ...keep, candles: [...candles, { t: close - 16 * HOUR, c: latest }] }
}

/**
 * New sync order when a universe opens: its missing symbols first (in its priority order), then
 * whatever was still waiting from before, then low-priority periodic refreshes. Symbols already
 * being fetched are not queued again.
 */
export function prioritize(queue: string[], urgent: string[], weekly: string[], inFlight: Set<string>): string[] {
  const front = urgent.filter((s) => !inFlight.has(s))
  const seen = new Set(front)
  const rest = queue.filter((s) => !seen.has(s))
  for (const s of rest) seen.add(s)
  return [...front, ...rest, ...weekly.filter((s) => !seen.has(s) && !inFlight.has(s))]
}
