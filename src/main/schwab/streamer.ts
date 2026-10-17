import { EventEmitter } from 'events'
import WebSocket from 'ws'
import type { Quote, StatusMessage } from '@shared/types'
import { fromSchwab, toSchwab } from '@shared/symbols'
import { auth } from '../auth/oauth'
import { accountActivityTriggers, F, FIELDS, num, parseLevelOne, refusedSymbols, type Content, type StreamResponse } from './levelOne'
import { chunk, getStreamerInfo, type StreamerInfo } from './market'

export type StreamState = 'off' | 'connecting' | 'live' | 'error'

export declare interface Streamer {
  on(e: 'quotes', fn: (q: Quote[]) => void): this
  /** Symbols Schwab refused to stream; the full list is re-sent after every (re)subscribe. */
  on(e: 'refused', fn: (symbols: string[]) => void): this
  /** Something happened on the account (an order filled, was cancelled…): positions may differ. */
  on(e: 'account', fn: () => void): this
  on(e: 'state', fn: (s: StreamState, msg?: StatusMessage) => void): this
}

export class Streamer extends EventEmitter {
  private ws?: WebSocket
  private info?: StreamerInfo
  private symbols: string[] = []
  private reqId = 0
  private retry = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private watchdog?: ReturnType<typeof setTimeout>
  private stopped = true
  private loggedIn = false
  private regularLast = new Map<string, number>()
  private pendingSubs = new Map<string, string[]>()
  private refused: string[] = []

  subscribe(symbols: string[]): void {
    this.symbols = [...new Set(symbols)]
    if (this.loggedIn) this.sendSubs()
    else if (this.stopped) this.start()
  }

  start(): void {
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.watchdog)
    this.ws?.removeAllListeners()
    this.ws?.close()
    this.ws = undefined
    this.loggedIn = false
    this.emit('state', 'off')
  }

  private async connect(): Promise<void> {
    this.emit('state', 'connecting')
    try {
      this.info = await getStreamerInfo()
      const token = await auth.accessToken()
      const ws = new WebSocket(this.info.streamerSocketUrl)
      this.ws = ws
      ws.on('open', () => this.send('ADMIN', 'LOGIN', { Authorization: token, SchwabClientChannel: this.info!.schwabClientChannel, SchwabClientFunctionId: this.info!.schwabClientFunctionId }))
      ws.on('message', (buf) => this.onMessage(buf.toString()))
      ws.on('close', () => this.scheduleReconnect({ key: 'streamClosed' }))
      ws.on('error', (e) => this.scheduleReconnect({ key: 'streamError', detail: e.message }))
    } catch (e) {
      this.scheduleReconnect({ key: 'streamError', detail: (e as Error).message })
    }
  }

  private scheduleReconnect(reason: StatusMessage): void {
    this.loggedIn = false
    clearTimeout(this.watchdog)
    this.ws?.removeAllListeners()
    this.ws?.terminate()
    this.ws = undefined
    if (this.stopped) return
    this.emit('state', 'error', reason)
    clearTimeout(this.reconnectTimer)
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
  }

  /** Schwab sends a heartbeat roughly every 10s; silence for 30s means the socket is dead. */
  private kickWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => this.scheduleReconnect({ key: 'heartbeat' }), 30_000)
  }

  private send(service: string, command: string, parameters: Record<string, string>): string | undefined {
    if (!this.ws || !this.info) return
    const requestid = String(this.reqId++)
    this.ws.send(
      JSON.stringify({
        requests: [
          {
            requestid,
            service,
            command,
            SchwabClientCustomerId: this.info.schwabClientCustomerId,
            SchwabClientCorrelId: this.info.schwabClientCorrelId,
            parameters
          }
        ]
      })
    )
    return requestid
  }

  private sendSubs(): void {
    const keys = this.symbols.map(toSchwab)
    if (!keys.length) return
    // SUBS replaces the whole subscription; ADD appends further batches.
    this.pendingSubs.clear()
    this.refused = []
    this.emit('refused', [])
    chunk(keys, 300).forEach((batch, i) => {
      const id = this.send('LEVELONE_EQUITIES', i === 0 ? 'SUBS' : 'ADD', { keys: batch.join(','), fields: FIELDS })
      if (id) this.pendingSubs.set(id, batch)
    })
  }

  private onMessage(text: string): void {
    this.kickWatchdog()
    let msg: { response?: StreamResponse[]; data?: { service: string; content?: Content[] }[] }
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    for (const r of msg.response ?? []) {
      if (r.service === 'ADMIN' && r.command === 'LOGIN') {
        if (r.content?.code === 0) {
          this.loggedIn = true
          this.retry = 0
          this.emit('state', 'live')
          this.sendSubs()
          // Order fills and other account events arrive on the same socket, at no request cost.
          this.send('ACCT_ACTIVITY', 'SUBS', { keys: 'Account Activity', fields: '0,1,2,3' })
        } else {
          this.scheduleReconnect({ key: 'streamLogin', detail: String(r.content?.msg ?? r.content?.code) })
        }
      }
    }
    const refused = refusedSymbols(msg.response ?? [], this.pendingSubs)
    if (refused.length) {
      this.refused.push(...refused)
      this.emit('refused', this.refused)
    }
    const quotes: Quote[] = []
    for (const d of msg.data ?? []) {
      if (d.service === 'ACCT_ACTIVITY') {
        if (accountActivityTriggers(d.content)) this.emit('account')
        continue
      }
      if (d.service !== 'LEVELONE_EQUITIES') continue
      for (const row of d.content ?? []) {
        const sym = row.key ? fromSchwab(row.key) : ''
        const reg = num(row[F.regularLast])
        if (reg) this.regularLast.set(sym, reg)
        const q = parseLevelOne(row, this.regularLast.get(sym))
        if (q) quotes.push(q)
      }
    }
    if (quotes.length) this.emit('quotes', quotes)
  }
}
