import type { AppConfig } from '@shared/types'
import { readJson, readSecret, writeJson, writeSecret } from './storage'

const DEFAULTS: AppConfig = { appKey: '', appSecret: '', callbackUrl: 'https://127.0.0.1' }

let cache: AppConfig | undefined

export function getConfig(): AppConfig {
  if (!cache) {
    // config.json may still hold a legacy `watchlist`; it now lives in settings.json.
    const { appKey, callbackUrl } = readJson<Partial<AppConfig>>('config.json', {})
    const secret = readSecret<{ appSecret: string }>('secret.bin')
    cache = { ...DEFAULTS, ...(appKey && { appKey }), ...(callbackUrl && { callbackUrl }), appSecret: secret?.appSecret ?? '' }
  }
  return cache
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...patch }
  const { appSecret, ...plain } = next
  writeJson('config.json', plain)
  if (patch.appSecret !== undefined) writeSecret('secret.bin', { appSecret })
  cache = next
  return next
}

export const isConfigured = (c = getConfig()) => Boolean(c.appKey && c.appSecret && c.callbackUrl)
