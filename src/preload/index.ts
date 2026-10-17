import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from './index.d'

const on =
  <T>(channel: string) =>
  (fn: (v: T) => void) => {
    const listener = (_: unknown, v: T) => fn(v)
    ipcRenderer.on(channel, listener)
    return () => void ipcRenderer.removeListener(channel, listener)
  }

const api: Api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getStatus: () => ipcRenderer.invoke('status:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  searchSymbols: (query) => ipcRenderer.invoke('symbols:search', query),
  lookupEtf: (ticker) => ipcRenderer.invoke('etf:lookup', ticker),
  etfNames: (tickers) => ipcRenderer.invoke('etf:names', tickers),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  cloudState: () => ipcRenderer.invoke('cloud:state'),
  cloudSignIn: () => ipcRenderer.invoke('cloud:signIn'),
  cloudSignOut: () => ipcRenderer.invoke('cloud:signOut'),
  setUniverse: (id) => ipcRenderer.invoke('data:setUniverse', id),
  candles: (symbol, period) => ipcRenderer.invoke('data:candles', symbol, period),
  refreshUniverses: () => ipcRenderer.invoke('data:refreshUniverses'),
  savePng: (dataUrl) => ipcRenderer.invoke('app:savePng', dataUrl),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggleFullscreen'),
  onTicks: on('data:ticks'),
  onRefs: on('data:refs'),
  onSnapshot: on('data:snapshot'),
  onHoldings: on('data:holdings'),
  onStatus: on('status'),
  onSettings: on('settings:changed'),
  onCloudState: on('cloud:state')
}

contextBridge.exposeInMainWorld('api', api)
