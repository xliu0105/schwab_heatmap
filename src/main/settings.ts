import { EventEmitter } from 'events'
import type { Prefs, SyncedSettings } from '@shared/types'
import { cleanWatchlist, withDefaults } from '@shared/settingsMerge'
import { readJson, writeJson } from './storage'

/**
 * The local copy of everything cloud sync carries (watchlist + view prefs). Works the same with
 * or without an account; sync only reconciles this file with the cloud.
 * Emits 'change' with the new settings and whether the change came from the cloud.
 */
class SettingsStore extends EventEmitter {
  private current: SyncedSettings

  constructor() {
    super()
    const stored = readJson<Partial<SyncedSettings> | undefined>('settings.json', undefined)
    // Before cloud sync the watchlist lived in config.json; carry it over once.
    const legacy = readJson<{ watchlist?: string[] }>('config.json', {}).watchlist
    this.current = withDefaults(stored ?? { watchlist: legacy ?? [] })
    if (!stored) writeJson('settings.json', this.current)
  }

  get(): SyncedSettings {
    return this.current
  }

  /** A local edit: stamps a new `updatedAt` so it wins over older cloud copies. */
  update(patch: { watchlist?: string[]; etfs?: string[]; prefs?: Partial<Prefs> }): SyncedSettings {
    const next: SyncedSettings = {
      watchlist: patch.watchlist ? cleanWatchlist(patch.watchlist) : this.current.watchlist,
      etfs: patch.etfs ? cleanWatchlist(patch.etfs) : this.current.etfs,
      prefs: { ...this.current.prefs, ...patch.prefs },
      updatedAt: Date.now()
    }
    this.save(next, false)
    return next
  }

  /** Replaces the local copy with one reconciled against the cloud. */
  replace(next: SyncedSettings): void {
    this.save(next, true)
  }

  private save(next: SyncedSettings, fromCloud: boolean): void {
    const watchlistChanged = next.watchlist.join() !== this.current.watchlist.join()
    const removedEtfs = this.current.etfs.filter((t) => !next.etfs.includes(t))
    this.current = next
    writeJson('settings.json', next)
    this.emit('change', next, { fromCloud, watchlistChanged, removedEtfs })
  }
}

export const settings = new SettingsStore()
