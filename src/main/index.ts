import './bootstrap'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig, Period, Prefs, SyncedSettings, UniverseId } from '@shared/types'
import { auth } from './auth/oauth'
import { getConfig, setConfig } from './config'
import { DataService } from './data/store'
import { findSymbols, refreshUniverses } from './data/universe'
import { etfNames, EtfNotFound, getEtf } from './data/etf'
import { normalizeSymbol } from '@shared/symbols'
import { sync } from './cloud/sync'
import { settings } from './settings'

let win: BrowserWindow | undefined
const data = new DataService()

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0f0f0f',
    title: 'Schwab Heatmap',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = undefined))
  win.on('focus', () => {
    sync.onFocus()
    data.onFocus()
  })
}

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload)
data.on('ticks', (q) => send('data:ticks', q))
data.on('refs', (r) => send('data:refs', r))
data.on('snapshot', (s) => send('data:snapshot', s))
data.on('holdings', (h) => send('data:holdings', h))
sync.on('state', (s) => send('cloud:state', s))
settings.on('change', async (s: SyncedSettings, { watchlistChanged }: { watchlistChanged: boolean }) => {
  send('settings:changed', s)
  if (watchlistChanged && data.universe === 'watchlist') send('data:snapshot', await data.reload())
})
data.on('status', (s) => send('status', s))

// Settings never expose the stored secret back to the renderer.
const publicConfig = () => {
  const { appSecret, ...rest } = getConfig()
  return { ...rest, hasSecret: Boolean(appSecret) }
}

ipcMain.handle('config:get', () => publicConfig())
ipcMain.handle('config:set', async (_e, patch: Partial<AppConfig>) => {
  const before = getConfig()
  setConfig(patch)
  if (patch.appKey !== undefined && patch.appKey !== before.appKey) auth.logout()
  data.status = { ...data.status, auth: auth.state() }
  send('status', data.status)
  return publicConfig()
})
ipcMain.handle('auth:login', async () => {
  await auth.login(win)
  send('data:snapshot', await data.reload())
})
ipcMain.handle('auth:logout', () => auth.logout())
ipcMain.handle('status:get', () => data.status)
ipcMain.handle('settings:get', () => settings.get())
ipcMain.handle('symbols:search', (_e, query: string) => findSymbols(query))
// Validates an ETF before it joins the list; answers instead of throwing so the UI can explain why.
ipcMain.handle('etf:lookup', async (_e, raw: string) => {
  const ticker = normalizeSymbol(raw)
  try {
    const etf = await getEtf(ticker)
    return { ok: true, ticker, name: etf.name, count: etf.holdings.length }
  } catch (e) {
    return { ok: false, ticker, reason: e instanceof EtfNotFound ? 'notFound' : 'failed', detail: (e as Error).message }
  }
})
ipcMain.handle('etf:names', (_e, tickers: string[]) => etfNames(tickers))
ipcMain.handle('settings:update', (_e, patch: { watchlist?: string[]; etfs?: string[]; prefs?: Partial<Prefs> }) => settings.update(patch))
ipcMain.handle('cloud:state', () => sync.getState())
ipcMain.handle('cloud:signIn', () => sync.signIn())
ipcMain.handle('cloud:signOut', () => sync.signOut())
ipcMain.handle('data:setUniverse', (_e, id: UniverseId) => data.setUniverse(id))
ipcMain.handle('data:candles', (_e, symbol: string, period: Period) => data.candles(symbol, period))
ipcMain.handle('data:refreshUniverses', async () => {
  await refreshUniverses()
  return data.reload()
})
ipcMain.handle('app:savePng', async (_e, dataUrl: string) => {
  const { filePath } = await dialog.showSaveDialog(win!, {
    defaultPath: `heatmap-${new Date().toISOString().slice(0, 10)}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }]
  })
  if (filePath) writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'))
  return Boolean(filePath)
})
ipcMain.handle('app:toggleFullscreen', () => win?.setFullScreen(!win.isFullScreen()))

app.whenReady().then(() => {
  sync.start()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => {
  data.shutdown()
  if (process.platform !== 'darwin') app.quit()
})
