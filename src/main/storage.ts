import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'

const root = () => app.getPath('userData')

export function readJson<T>(name: string, fallback: T): T {
  const file = join(root(), name)
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Like readJson, without blocking the main process (for reading thousands of cache files). */
export async function readJsonAsync<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(root(), name), 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(name: string, value: unknown): void {
  const file = join(root(), name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

/** Stores a secret encrypted with the OS keychain-backed key. */
export function writeSecret(name: string, value: unknown): void {
  const file = join(root(), name)
  const text = JSON.stringify(value)
  writeFileSync(file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text)
}

export function readSecret<T>(name: string): T | undefined {
  const file = join(root(), name)
  if (!existsSync(file)) return undefined
  try {
    const raw = readFileSync(file)
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? join(process.resourcesPath, ...parts)
    : join(app.getAppPath(), 'resources', ...parts)
}
