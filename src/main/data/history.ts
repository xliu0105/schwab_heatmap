import { EventEmitter } from 'events'
import type { Candle, Quote } from '@shared/types'
import { lastMarketClose } from '@shared/marketTime'
import { FULL_REFRESH_MS, patchFromQuote, prioritize, type HistoryEntry } from '@shared/historyPatch'
import { getDailyHistory, getIntraday } from '../schwab/market'
import { readJson, writeJson } from '../storage'

const INTRADAY_TTL_MS = 60 * 1000
const WORKERS = 4

type OnSymbol = (symbol: string, candles: Candle[]) => void

/**
 * Daily closes per symbol, cached on disk and shared by every universe.
 *
 * A day-old cache is usually brought up to date from the batch quotes the universe load already
 * fetched (no extra requests); only missing, gapped or adjusted histories are refetched, through
 * one persistent queue. Opening another universe moves its symbols to the front of that queue
 * instead of cancelling what was left of the previous one.
 */
export class HistoryCache extends EventEmitter {
  private daily = new Map<string, HistoryEntry>()
  private intraday = new Map<string, HistoryEntry>()
  private queue: string[] = []
  private inFlight = new Set<string>()
  private current = new Set<string>()
  private workers = 0
  private onSymbol?: OnSymbol

  get(symbol: string): Candle[] | undefined {
    return this.load(symbol)?.candles
  }

  private load(symbol: string): HistoryEntry | undefined {
    let e = this.daily.get(symbol)
    if (!e) {
      e = readJson<HistoryEntry | undefined>(`history/${symbol}.json`, undefined)
      if (e) this.daily.set(symbol, e)
    }
    return e
  }

  private save(symbol: string, e: HistoryEntry): void {
    this.daily.set(symbol, e)
    writeJson(`history/${symbol}.json`, e)
  }

  /**
   * Makes `symbols` (the universe on screen, in priority order) current: fresh or quote-patchable
   * histories are reported at once, the rest are queued ahead of any older backlog.
   */
  fill(symbols: string[], onSymbol: OnSymbol, quotes?: Map<string, Quote>): void {
    this.onSymbol = onSymbol
    this.current = new Set(symbols)
    const now = Date.now()
    const close = lastMarketClose(now)
    const urgent: string[] = []
    const weekly: string[] = []
    for (const s of symbols) {
      const e = this.load(s)
      const patched = e && e.fetchedAt >= close ? e : patchFromQuote(e, quotes?.get(s), now)
      if (patched) {
        if (patched !== e) this.save(s, patched)
        onSymbol(s, patched.candles)
        // Still usable today, but due for its periodic full refetch: do it after everything urgent.
        if (now - (patched.fullAt ?? patched.fetchedAt) > FULL_REFRESH_MS) weekly.push(s)
      } else urgent.push(s)
    }
    this.queue = prioritize(this.queue, urgent, weekly, this.inFlight)
    this.emitProgress()
    while (this.workers < WORKERS && this.queue.length) {
      this.workers++
      void this.work()
    }
  }

  /** Progress of the universe on screen; background refreshes and older backlog don't count. */
  private emitProgress(): void {
    const total = this.current.size
    let pending = 0
    const waiting = new Set(this.queue)
    for (const s of this.current) if (waiting.has(s) || this.inFlight.has(s)) pending++
    this.emit('progress', { done: total - pending, total })
  }

  private async work(): Promise<void> {
    for (let s = this.queue.shift(); s; s = this.queue.shift()) {
      this.inFlight.add(s)
      try {
        const candles = await getDailyHistory(s)
        const now = Date.now()
        this.save(s, { fetchedAt: now, fullAt: now, candles })
        this.onSymbol?.(s, candles)
      } catch {
        // Leave the symbol without long-period data; the next fill retries it.
      } finally {
        this.inFlight.delete(s)
      }
      this.emitProgress()
    }
    this.workers--
  }

  cancel(): void {
    this.queue = []
  }

  async intradayFor(symbol: string): Promise<Candle[]> {
    const e = this.intraday.get(symbol)
    if (e && Date.now() - e.fetchedAt < INTRADAY_TTL_MS) return e.candles
    const candles = await getIntraday(symbol)
    this.intraday.set(symbol, { fetchedAt: Date.now(), candles })
    return candles
  }
}
