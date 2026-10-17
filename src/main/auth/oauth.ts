import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import type { AuthState } from '@shared/types'
import { getConfig, isConfigured } from '../config'
import { readSecret, writeSecret } from '../storage'

const AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize'
const TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token'
// Schwab refresh tokens live 7 days and cannot be extended; after that the user must log in again.
const REFRESH_TTL_MS = 7 * 24 * 3600 * 1000
const EARLY_REFRESH_MS = 60 * 1000

interface Tokens {
  accessToken: string
  refreshToken: string
  accessExpiresAt: number
  refreshExpiresAt: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

class SchwabAuth extends EventEmitter {
  private tokens = readSecret<Tokens>('tokens.bin')
  private refreshing?: Promise<string>

  state(): AuthState {
    if (!isConfigured()) return { status: 'needsConfig' }
    if (!this.tokens || this.tokens.refreshExpiresAt <= Date.now()) return { status: 'loggedOut' }
    return { status: 'loggedIn', refreshExpiresAt: this.tokens.refreshExpiresAt }
  }

  /** Opens Schwab's login page and captures the authorization code from the callback redirect. */
  login(parent?: BrowserWindow): Promise<void> {
    const { appKey, callbackUrl } = getConfig()
    const url = `${AUTH_URL}?client_id=${encodeURIComponent(appKey)}&redirect_uri=${encodeURIComponent(callbackUrl)}`
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent,
      modal: Boolean(parent),
      title: 'Schwab 登录',
      webPreferences: { partition: 'persist:schwab-login' }
    })

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        if (!win.isDestroyed()) win.close()
        err ? reject(err) : resolve()
      }
      const intercept = (event: Electron.Event, target: string) => {
        if (!target.startsWith(callbackUrl)) return
        event.preventDefault()
        const code = new URL(target).searchParams.get('code')
        if (!code) return finish(new Error('回调里没有 code 参数'))
        this.exchange({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl })
          .then(() => finish())
          .catch(finish)
      }
      win.webContents.on('will-redirect', intercept)
      win.webContents.on('will-navigate', intercept)
      win.on('closed', () => finish(new Error('登录窗口已关闭')))
      win.loadURL(url)
    })
  }

  logout(): void {
    this.tokens = undefined
    writeSecret('tokens.bin', null)
    this.emit('change', this.state())
  }

  /** Returns a valid access token, refreshing it when it is about to expire. */
  async accessToken(): Promise<string> {
    const t = this.tokens
    if (!t || t.refreshExpiresAt <= Date.now()) throw new AuthError('需要重新登录 Schwab')
    if (t.accessExpiresAt - EARLY_REFRESH_MS > Date.now()) return t.accessToken
    return this.forceRefresh()
  }

  forceRefresh(): Promise<string> {
    if (!this.refreshing) {
      const t = this.tokens
      if (!t) return Promise.reject(new AuthError('需要重新登录 Schwab'))
      this.refreshing = this.exchange({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
        .then(() => this.tokens!.accessToken)
        .finally(() => (this.refreshing = undefined))
    }
    return this.refreshing
  }

  private async exchange(body: Record<string, string>): Promise<void> {
    const { appKey, appSecret } = getConfig()
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(body)
    })
    if (!res.ok) {
      const text = await res.text()
      if (body.grant_type === 'refresh_token') this.logout()
      throw new AuthError(`Schwab token 请求失败 (${res.status}): ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as TokenResponse
    const now = Date.now()
    const isNewLogin = body.grant_type === 'authorization_code'
    this.tokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      accessExpiresAt: now + json.expires_in * 1000,
      refreshExpiresAt: isNewLogin || !this.tokens ? now + REFRESH_TTL_MS : this.tokens.refreshExpiresAt
    }
    writeSecret('tokens.bin', this.tokens)
    this.emit('change', this.state())
  }
}

export class AuthError extends Error {}

export const auth = new SchwabAuth()
