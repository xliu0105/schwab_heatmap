import { EventEmitter } from 'events'
import type { Candle, Constituent, Period, Quote, RefTable, Snapshot, StatusInfo, UniverseId } from '@shared/types'
import { periodStart, referenceCloses } from '@shared/perf'
import { benchmarkFor } from '@shared/aggregate'
import { holdingsChanged } from '@shared/positions'
import { auth } from '../auth/oauth'
import { getQuotes, getSharesOutstanding } from '../schwab/market'
import { Streamer } from '../schwab/streamer'
import { readJson, writeJson } from '../storage'
import { demoData, demoEnabled, demoTick } from './demo'
import { HistoryCache } from './history'
import { loadUniverse, symbolTable } from './universe'

const TICK_FLUSH_MS = 100
const SHARES_TTL_MS = 7 * 24 * 3600 * 1000
const POLL_MS = 30_000
// Index quotes may not stream, so the page's benchmark is also refreshed by a cheap poll.
const BENCHMARK_POLL_MS = 15_000
// Positions refresh: soon after an account event (fills often arrive in parts), and as a fallback.
const HOLDINGS_EVENT_DELAY_MS = 2000
const HOLDINGS_POLL_MS = 60_000
// Above this many missing share counts, draw with the bundled ones first and refine in the background.
const BLOCKING_SHARES_MAX = 300

interface SharesCache {
  fetchedAt: Record<string, number>
  shares: Record<string, number>
}

/**
 * Owns everything the renderer draws: the current universe, merged quotes, and reference closes.
 * Emits 'ticks' (changed quotes, batched), 'refs' (new reference closes), 'snapshot' (the whole
 * view changed, e.g. better market caps arrived) and 'status'.
 */
export class DataService extends EventEmitter {
  universe: UniverseId = 'sp500'
  private constituents: Constituent[] = []
  private quotes = new Map<string, Quote>()
  private refs: RefTable = {}
  private sharesCache = readJson<SharesCache>('shares.json', { fetchedAt: {}, shares: {} })
  private pending = new Map<string, Quote>()
  private flushTimer?: ReturnType<typeof setTimeout>
  private history = new HistoryCache()
  private streamer = new Streamer()
  private loadSeq = 0
  status: StatusInfo = { auth: auth.state(), stream: 'off' }

  private demoTimer?: ReturnType<typeof setInterval>
  private polled = new Set<string>()
  private pollTimer = setInterval(() => void this.poll(), POLL_MS)
  private benchmark?: string
  private benchmarkTimer = setInterval(() => void this.pollBenchmark(), BENCHMARK_POLL_MS)
  private holdingsTimer = setInterval(() => void this.refreshHoldings(), HOLDINGS_POLL_MS)
  private holdingsDebounce?: ReturnType<typeof setTimeout>
  private refreshingHoldings = false

  constructor() {
    super()
    if (demoEnabled()) this.status = { auth: { status: 'loggedIn', refreshExpiresAt: Date.now() + 6 * 86_400_000 }, stream: 'live', message: { key: 'demo' } }
    this.streamer.on('quotes', (qs) => qs.forEach((q) => this.merge(q)))
    this.streamer.on('state', (stream, message) => this.setStatus({ stream, message }))
    this.streamer.on('refused', (symbols) => {
      this.polled = new Set(symbols)
      this.setStatus({ polled: symbols.length })
      if (symbols.length) void this.poll()
    })
    this.streamer.on('account', () => {
      clearTimeout(this.holdingsDebounce)
      this.holdingsDebounce = setTimeout(() => void this.refreshHoldings(), HOLDINGS_EVENT_DELAY_MS)
    })
    this.history.on('progress', (historyProgress) => this.setStatus({ historyProgress }))
    auth.on('change', (state) => {
      this.setStatus({ auth: state })
      if (state.status !== 'loggedIn') this.streamer.stop()
    })
  }

  private setStatus(patch: Partial<StatusInfo>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  snapshot(): Snapshot {
    const symbols = new Set(this.constituents.map((c) => c.symbol))
    // Schwab answering for the index/ETF symbol is what makes it usable as the page's move.
    const benchmark = this.benchmark && this.quotes.has(this.benchmark) ? this.benchmark : undefined
    if (benchmark) symbols.add(benchmark)
    return {
      universe: this.universe,
      constituents: this.constituents,
      quotes: Object.fromEntries([...this.quotes].filter(([s]) => symbols.has(s))),
      refs: Object.fromEntries(Object.entries(this.refs).filter(([s]) => symbols.has(s))),
      benchmark
    }
  }

  async setUniverse(id: UniverseId): Promise<Snapshot> {
    const seq = ++this.loadSeq
    this.universe = id
    this.benchmark = benchmarkFor(id)
    if (demoEnabled()) return this.loadDemo(id)
    const loggedIn = auth.state().status === 'loggedIn'
    try {
      this.constituents = id === 'holdings' && !loggedIn ? [] : await loadUniverse(id)
    } catch (e) {
      this.constituents = []
      this.setStatus({ message: { key: 'loadFailed', detail: (e as Error).message } })
    }
    if (!loggedIn || seq !== this.loadSeq) return this.snapshot()

    const symbols = this.constituents.map((c) => c.symbol)
    const withBenchmark = this.benchmark && !symbols.includes(this.benchmark) ? [...symbols, this.benchmark] : symbols
    try {
      const big = this.staleShares(symbols).length > BLOCKING_SHARES_MAX
      const shares = this.ensureShares(symbols, big)
      const [quotes] = await Promise.all([getQuotes(withBenchmark), big ? undefined : shares])
      if (big)
        void shares.then(() => {
          if (seq !== this.loadSeq) return
          this.recomputeCaps()
          this.emit('snapshot', this.snapshot())
        })
      if (seq !== this.loadSeq) return this.snapshot()
      for (const q of quotes) this.merge(q, false)
      this.setStatus({ message: undefined })
    } catch (e) {
      this.setStatus({ message: { key: 'quotesFailed', detail: (e as Error).message } })
    }

    this.streamer.subscribe(withBenchmark)
    // The benchmark first (it's the headline number), then the biggest companies: they are the
    // tiles you see, so they should get colors first.
    const bySize = [...symbols].sort((a, b) => (this.quotes.get(b)?.marketCap ?? 0) - (this.quotes.get(a)?.marketCap ?? 0))
    const order = this.benchmark && this.quotes.has(this.benchmark) ? [this.benchmark, ...bySize.filter((s) => s !== this.benchmark)] : bySize
    void this.history.fill(order, (s, candles) => this.onHistory(s, candles))
    return this.snapshot()
  }

  private async loadDemo(id: UniverseId): Promise<Snapshot> {
    this.constituents = id === 'holdings' ? [] : await loadUniverse(id)
    const { quotes, refs } = demoData(this.constituents, symbolTable())
    for (const q of quotes) this.quotes.set(q.symbol, q)
    Object.assign(this.refs, refs)
    clearInterval(this.demoTimer)
    this.demoTimer = setInterval(() => demoTick(this.quotes).forEach((q) => this.merge(q)), 1000)
    return this.snapshot()
  }

  /** Re-runs the current universe, e.g. after login or a watchlist edit. */
  reload(): Promise<Snapshot> {
    return this.setUniverse(this.universe)
  }

  private staleShares(symbols: string[]): string[] {
    const now = Date.now()
    return symbols.filter((s) => !(now - (this.sharesCache.fetchedAt[s] ?? 0) < SHARES_TTL_MS))
  }

  private recomputeCaps(): void {
    for (const q of this.quotes.values()) {
      const shares = this.shares(q.symbol)
      if (shares && q.last) q.marketCap = shares * q.last
    }
  }

  private async pollBenchmark(): Promise<void> {
    const b = this.benchmark
    if (!b || !this.quotes.has(b) || auth.state().status !== 'loggedIn' || demoEnabled()) return
    try {
      for (const q of await getQuotes([b])) this.merge(q)
    } catch {
      // Next round retries.
    }
  }

  /** Window regained focus: trades may have happened elsewhere (thinkorswim, phone). */
  onFocus(): void {
    void this.refreshHoldings()
  }

  /**
   * Re-reads positions while the holdings map is open. A new or closed position rebuilds the map;
   * a size change only updates shares/values in place ('holdings' event), so tiles don't move.
   */
  private async refreshHoldings(): Promise<void> {
    if (this.universe !== 'holdings' || this.refreshingHoldings || auth.state().status !== 'loggedIn') return
    this.refreshingHoldings = true
    const seq = this.loadSeq
    try {
      const next = await loadUniverse('holdings')
      if (seq !== this.loadSeq || this.universe !== 'holdings') return
      if (holdingsChanged(this.constituents, next)) {
        this.emit('snapshot', await this.setUniverse('holdings'))
        return
      }
      const bySymbol = new Map(next.map((c) => [c.symbol, c]))
      for (const c of this.constituents) {
        const n = bySymbol.get(c.symbol)!
        c.shares = n.shares
        c.value = n.value
        c.dayPL = n.dayPL
      }
      this.emit('holdings', next.map(({ symbol, shares, value, dayPL }) => ({ symbol, shares, value, dayPL })))
    } catch {
      // Keep what's on screen; the next event or poll retries.
    } finally {
      this.refreshingHoldings = false
    }
  }

  /** Symbols the streamer refused are refreshed with batch quotes instead. */
  private async poll(): Promise<void> {
    if (!this.polled.size || auth.state().status !== 'loggedIn') return
    try {
      for (const q of await getQuotes([...this.polled])) this.merge(q)
    } catch {
      // The next round retries; streamed symbols are unaffected.
    }
  }

  private async ensureShares(symbols: string[], background: boolean): Promise<void> {
    const now = Date.now()
    const stale = this.staleShares(symbols)
    if (!stale.length) return
    try {
      const shares = await getSharesOutstanding(stale, background)
      for (const s of stale) this.sharesCache.fetchedAt[s] = now
      Object.assign(this.sharesCache.shares, shares)
      writeJson('shares.json', this.sharesCache)
    } catch {
      // Bundled share counts from the universe snapshot are good enough as a fallback.
    }
  }

  private shares(symbol: string): number | undefined {
    return this.sharesCache.shares[symbol] ?? symbolTable()[symbol]?.shares
  }

  private merge(q: Quote, live = true): void {
    const prev = this.quotes.get(q.symbol)
    const next: Quote = { ...prev, ...q }
    const shares = this.shares(q.symbol)
    if (shares && next.last) next.marketCap = shares * next.last
    this.quotes.set(q.symbol, next)
    if (!live) return
    this.pending.set(q.symbol, next)
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined
      const batch = [...this.pending.values()]
      this.pending.clear()
      this.emit('ticks', batch)
    }, TICK_FLUSH_MS)
  }

  private refsBuffer: RefTable = {}
  private refsTimer?: ReturnType<typeof setTimeout>

  private onHistory(symbol: string, candles: Candle[]): void {
    const r = referenceCloses(candles, new Date())
    this.refs[symbol] = r
    this.refsBuffer[symbol] = r
    this.refsTimer ??= setTimeout(() => {
      this.refsTimer = undefined
      this.emit('refs', this.refsBuffer)
      this.refsBuffer = {}
    }, 500)
  }

  /** Price series for the tooltip chart, matching the selected color period. */
  async candles(symbol: string, period: Period): Promise<Candle[]> {
    if (demoEnabled()) {
      const q = this.quotes.get(symbol)
      let v = q?.prevClose ?? 100
      return Array.from({ length: 78 }, (_, i) => ({ t: i, c: (v *= 1 + (Math.random() - 0.5) * 0.004) }))
    }
    if (auth.state().status !== 'loggedIn') return []
    if (period === '1D' || period === 'EXT') return this.history.intradayFor(symbol).catch(() => [])
    const daily = this.history.get(symbol) ?? []
    const start = periodStart(period, new Date()) ?? 0
    return daily.filter((c) => c.t >= start)
  }

  shutdown(): void {
    clearInterval(this.pollTimer)
    clearInterval(this.benchmarkTimer)
    clearInterval(this.holdingsTimer)
    clearTimeout(this.holdingsDebounce)
    clearInterval(this.demoTimer)
    this.history.cancel()
    this.streamer.stop()
  }
}
