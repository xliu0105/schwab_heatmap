import { EventEmitter } from 'events'
import type { CloudState, SyncedSettings } from '@shared/types'
import { mergeSettings, withDefaults } from '@shared/settingsMerge'
import { settings } from '../settings'
import { readSecret, writeSecret } from '../storage'
import { cloudConfig } from './config'
import { getUserDoc, putUserDoc, refreshSession, signInWithGoogleIdToken, type FirebaseSession } from './firebase'
import { googleSignIn } from './googleAuth'
import { CloudError } from './oauthUtil'
import type { Json } from './firestoreCodec'

const POLL_MS = 60_000
const PUSH_DEBOUNCE_MS = 1000

/**
 * Keeps settings.json and the user's Firestore document in step: pulls on start, on window focus
 * and every minute; pushes local edits after a short debounce. Offline edits just stay local and
 * win on the next successful sync because their `updatedAt` is newer.
 */
class SyncService extends EventEmitter {
  private session = readSecret<FirebaseSession>('cloud.bin') ?? undefined
  private state: CloudState = { status: 'signedOut' }
  private pollTimer?: ReturnType<typeof setInterval>
  private pushTimer?: ReturnType<typeof setTimeout>
  private running?: Promise<void>

  start(): void {
    if (!cloudConfig()) {
      this.setState({ status: 'unconfigured' })
      return
    }
    settings.on('change', (_s: SyncedSettings, { fromCloud }: { fromCloud: boolean }) => {
      if (!fromCloud) this.schedulePush()
    })
    if (this.session) {
      this.setState({ status: 'signedIn', email: this.session.email, photoUrl: this.session.photoUrl })
      this.startPolling()
      void this.sync(false)
    } else this.setState({ status: 'signedOut' })
  }

  getState(): CloudState {
    return this.state
  }

  async signIn(): Promise<void> {
    const cfg = cloudConfig()
    if (!cfg) return
    this.setState({ status: 'signingIn', error: undefined })
    try {
      const googleToken = await googleSignIn(cfg.google.clientId, cfg.google.clientSecret)
      this.saveSession(await signInWithGoogleIdToken(cfg, googleToken))
      this.setState({ status: 'signedIn', email: this.session!.email, photoUrl: this.session!.photoUrl })
      this.startPolling()
      await this.sync(true)
    } catch (e) {
      this.session = undefined
      this.setState({ status: 'signedOut', error: asStateError(e) })
    }
  }

  signOut(): void {
    clearInterval(this.pollTimer)
    clearTimeout(this.pushTimer)
    this.session = undefined
    writeSecret('cloud.bin', null)
    this.setState({ status: 'signedOut', email: undefined, photoUrl: undefined, lastSync: undefined, error: undefined })
  }

  /** Called when the window regains focus: pick up edits made on another machine. */
  onFocus(): void {
    if (this.session) void this.sync(false)
  }

  private startPolling(): void {
    clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => void this.sync(false), POLL_MS)
  }

  private schedulePush(): void {
    if (!this.session) return
    clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => void this.sync(false), PUSH_DEBOUNCE_MS)
  }

  /** One pull-merge-push round; overlapping calls share the round in flight. */
  private sync(firstSignIn: boolean): Promise<void> {
    if (this.running) return this.running
    this.running = this.syncOnce(firstSignIn).finally(() => (this.running = undefined))
    return this.running
  }

  private async syncOnce(firstSignIn: boolean): Promise<void> {
    const cfg = cloudConfig()
    if (!cfg || !this.session) return
    this.setState({ syncing: true })
    try {
      const s = await this.freshSession()
      const raw = await getUserDoc(cfg, s)
      const remote = raw ? withDefaults(raw as Partial<SyncedSettings>) : undefined
      const { settings: merged, push, changed } = mergeSettings(settings.get(), remote, firstSignIn, Date.now())
      if (changed) settings.replace(merged)
      if (push) await putUserDoc(cfg, s, toDoc(merged))
      this.setState({ syncing: false, lastSync: Date.now(), error: undefined })
    } catch (e) {
      // A dead refresh token (revoked access, deleted project) means signing in again.
      if (e instanceof CloudError && e.key === 'firebase' && /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND/.test(e.detail ?? '')) {
        this.signOut()
      }
      this.setState({ syncing: false, error: asStateError(e) })
    }
  }

  private async freshSession(): Promise<FirebaseSession> {
    const s = this.session!
    if (s.expiresAt - 60_000 > Date.now()) return s
    this.saveSession(await refreshSession(cloudConfig()!, s))
    return this.session!
  }

  private saveSession(s: FirebaseSession): void {
    this.session = s
    writeSecret('cloud.bin', s)
  }

  private setState(patch: Partial<CloudState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }
}

const toDoc = (s: SyncedSettings): { [k: string]: Json } => ({
  watchlist: s.watchlist,
  etfs: s.etfs,
  prefs: s.prefs as unknown as { [k: string]: Json },
  updatedAt: s.updatedAt
})

function asStateError(e: unknown): CloudState['error'] {
  return e instanceof CloudError ? { key: e.key, detail: e.detail } : { key: 'network', detail: (e as Error).message }
}

export const sync = new SyncService()
