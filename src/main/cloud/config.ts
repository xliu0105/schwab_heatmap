import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { resourcePath } from '../storage'

export interface CloudConfig {
  firebase: { apiKey: string; projectId: string }
  google: { clientId: string; clientSecret: string }
}

let cached: CloudConfig | null | undefined

/** cloud.config.json ships inside the app (extraResources); without it, accounts are simply off. */
export function cloudConfig(): CloudConfig | null {
  if (cached !== undefined) return cached
  const file = app.isPackaged ? resourcePath('cloud.config.json') : join(app.getAppPath(), 'cloud.config.json')
  cached = null
  if (existsSync(file)) {
    try {
      const c = JSON.parse(readFileSync(file, 'utf8')) as CloudConfig
      if (c.firebase?.apiKey && c.firebase?.projectId && c.google?.clientId && c.google?.clientSecret) cached = c
    } catch {
      // Malformed file: treat as not configured rather than crash at startup.
    }
  }
  return cached
}
