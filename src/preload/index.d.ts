import type { SymbolEntry } from '../shared/symbolSearch'
import type { AppConfig, Candle, Constituent, CloudState, Period, Prefs, Quote, RefTable, Snapshot, StatusInfo, SyncedSettings, UniverseId } from '../shared/types'

export type EtfLookup =
  | { ok: true; ticker: string; name?: string; count: number }
  | { ok: false; ticker: string; reason: 'notFound' | 'failed'; detail?: string }

export type PublicConfig = Omit<AppConfig, 'appSecret'> & { hasSecret: boolean }

export interface Api {
  getConfig(): Promise<PublicConfig>
  setConfig(patch: Partial<AppConfig>): Promise<PublicConfig>
  login(): Promise<void>
  logout(): Promise<void>
  getStatus(): Promise<StatusInfo>
  getSettings(): Promise<SyncedSettings>
  searchSymbols(query: string): Promise<SymbolEntry[]>
  lookupEtf(ticker: string): Promise<EtfLookup>
  etfNames(tickers: string[]): Promise<Record<string, string>>
  /** Records renderer-side timings in userData/perf.log. */
  perf(event: string, data: Record<string, number | string | boolean>): void
  updateSettings(patch: { watchlist?: string[]; etfs?: string[]; prefs?: Partial<Prefs> }): Promise<SyncedSettings>
  cloudState(): Promise<CloudState>
  cloudSignIn(): Promise<void>
  cloudSignOut(): Promise<void>
  setUniverse(id: UniverseId): Promise<Snapshot>
  candles(symbol: string, period: Period): Promise<Candle[]>
  refreshUniverses(): Promise<Snapshot>
  savePng(dataUrl: string): Promise<boolean>
  toggleFullscreen(): Promise<void>
  onTicks(fn: (q: Quote[]) => void): () => void
  onRefs(fn: (r: RefTable) => void): () => void
  onSnapshot(fn: (s: Snapshot) => void): () => void
  /** Fresh quotes arrived for a universe drawn from remembered prices. */
  onRefreshed(fn: (universe: UniverseId) => void): () => void
  onHoldings(fn: (h: Pick<Constituent, 'symbol' | 'shares' | 'value' | 'dayPL'>[]) => void): () => void
  onStatus(fn: (s: StatusInfo) => void): () => void
  onSettings(fn: (s: SyncedSettings) => void): () => void
  onCloudState(fn: (s: CloudState) => void): () => void
}

declare global {
  interface Window {
    api: Api
  }
}
