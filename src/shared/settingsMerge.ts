import type { Prefs, SyncedSettings } from './types'
import { normalizeSymbol } from './symbols'

export const DEFAULT_PREFS: Prefs = { lang: 'zh', universe: 'sp500', period: '1D', sizeBy: 'marketCap', etfSizeBy: 'weight', grouped: true }
export const DEFAULT_ETFS = ['SMH', 'QQQM', 'XLP', 'VOO']

export function cleanWatchlist(list: string[]): string[] {
  return [...new Set(list.map(normalizeSymbol).filter(Boolean))]
}

/** Fills in prefs added in newer versions, so an old cloud copy never leaves a field undefined. */
export function withDefaults(s: Partial<SyncedSettings>): SyncedSettings {
  return {
    watchlist: cleanWatchlist(s.watchlist ?? []),
    etfs: cleanWatchlist(s.etfs ?? DEFAULT_ETFS),
    prefs: { ...DEFAULT_PREFS, ...s.prefs },
    updatedAt: s.updatedAt ?? 0
  }
}

export interface MergeResult {
  settings: SyncedSettings
  /** True when the cloud copy is behind and should be overwritten with `settings`. */
  push: boolean
  /** True when `settings` differs from the local copy. */
  changed: boolean
}

/**
 * Reconciles the local copy with the cloud copy. Normally the newer `updatedAt` wins whole.
 * On the first sign-in on a machine nothing is thrown away: watchlists are unioned (cloud order
 * first) and cloud prefs win, since they are what the user set up elsewhere.
 */
export function mergeSettings(local: SyncedSettings, remote: SyncedSettings | undefined, firstSignIn: boolean, now: number): MergeResult {
  if (!remote) return { settings: local, push: true, changed: false }
  if (firstSignIn) {
    const watchlist = cleanWatchlist([...remote.watchlist, ...local.watchlist])
    const etfs = cleanWatchlist([...remote.etfs, ...local.etfs])
    const addsToCloud = watchlist.length !== remote.watchlist.length || etfs.length !== remote.etfs.length
    const settings = addsToCloud ? { watchlist, etfs, prefs: remote.prefs, updatedAt: now } : remote
    return { settings, push: addsToCloud, changed: !same(settings, local) }
  }
  if (remote.updatedAt > local.updatedAt) return { settings: remote, push: false, changed: !same(remote, local) }
  if (local.updatedAt > remote.updatedAt) return { settings: local, push: true, changed: false }
  return { settings: local, push: false, changed: false }
}

const same = (a: SyncedSettings, b: SyncedSettings) =>
  JSON.stringify([a.watchlist, a.etfs, a.prefs]) === JSON.stringify([b.watchlist, b.etfs, b.prefs])
