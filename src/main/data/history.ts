import { EventEmitter } from 'events'
import type { Candle } from '@shared/types'
import { lastMarketClose } from '@shared/marketTime'
import { getDailyHistory, getIntraday } from '../schwab/market'
import { readJson, writeJson } from '../storage'

const INTRADAY_TTL_MS = 60 * 1000

interface Entry {
  fetchedAt: number
  candles: Candle[]
}

/** Daily closes per symbol, cached on disk and shared by every universe, refreshed once per close. */
export class HistoryCache extends EventEmitter {
  private daily = new Map<string, Entry>()
  private intraday = new Map<string, Entry>()
  private generation = 0

  get(symbol: string): Candle[] | undefined {
    return this.load(symbol)?.candles
  }

  private load(symbol: string): Entry | undefined {
    let e = this.daily.get(symbol)
    if (!e) {
      e = readJson<Entry | undefined>(`history/${symbol}.json`, undefined)
      if (e) this.daily.set(symbol, e)
    }
    return e
  }

  /** Fetches stale symbols in the background; a newer call cancels the older one. */
  async fill(symbols: string[], onSymbol: (symbol: string, candles: Candle[]) => void): Promise<void> {
    const gen = ++this.generation
    // Daily bars only change at the close, so anything fetched after the last close is current.
    const close = lastMarketClose(Date.now())
    const fresh = (s: string) => {
      const e = this.load(s)
      return e && e.fetchedAt >= close
    }
    const todo = symbols.filter((s) => !fresh(s))
    let done = symbols.length - todo.length
    this.emit('progress', { done, total: symbols.length })
    for (const s of symbols) if (fresh(s)) onSymbol(s, this.load(s)!.candles)

    // A small worker pool pulls from the queue, so cancelling stops requests that haven't started yet.
    const queue = [...todo]
    const worker = async () => {
      for (let s = queue.shift(); s && gen === this.generation; s = queue.shift()) {
        try {
          const candles = await getDailyHistory(s)
          const entry = { fetchedAt: Date.now(), candles }
          this.daily.set(s, entry)
          writeJson(`history/${s}.json`, entry)
          if (gen === this.generation) onSymbol(s, candles)
        } catch {
          // Leave the symbol without long-period data; it is retried on the next fill.
        }
        done++
        if (gen === this.generation) this.emit('progress', { done, total: symbols.length })
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
  }

  cancel(): void {
    this.generation++
  }

  async intradayFor(symbol: string): Promise<Candle[]> {
    const e = this.intraday.get(symbol)
    if (e && Date.now() - e.fetchedAt < INTRADAY_TTL_MS) return e.candles
    const candles = await getIntraday(symbol)
    this.intraday.set(symbol, { fetchedAt: Date.now(), candles })
    return candles
  }
}
