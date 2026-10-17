import type { Quote } from '@shared/types'
import { fromSchwab } from '@shared/symbols'

// LEVELONE_EQUITIES field ids (Schwab Streamer API).
export const F = {
  symbol: 0,
  last: 3,
  volume: 8,
  close: 12,
  netChange: 18,
  regularLast: 29,
  regularNetChange: 31,
  netPct: 42,
  regularPct: 43
} as const
export const FIELDS = Object.values(F).join(',')

export type Content = Record<string, unknown> & { key?: string }

export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Turns one streamer content row into a partial quote. Rows only carry the fields that changed. */
export function parseLevelOne(row: Content, prevRegularLast?: number): Quote | undefined {
  if (!row.key) return undefined
  const q: Quote = { symbol: fromSchwab(row.key) }
  const last = num(row[F.last])
  const regular = num(row[F.regularLast]) ?? prevRegularLast
  if (last !== undefined) q.last = last
  if (num(row[F.regularLast]) !== undefined) q.regularLast = num(row[F.regularLast])
  if (num(row[F.close]) !== undefined) q.prevClose = num(row[F.close])
  if (num(row[F.volume]) !== undefined) q.volume = num(row[F.volume])
  const change = num(row[F.regularNetChange]) ?? num(row[F.netChange])
  if (change !== undefined) q.change = change
  const pct = num(row[F.regularPct]) ?? num(row[F.netPct])
  if (pct !== undefined) q.changePct = pct
  if (last !== undefined && regular) q.extPct = (last / regular - 1) * 100
  return q
}

export interface StreamResponse {
  service: string
  command: string
  requestid?: string
  content?: { code?: number; msg?: string }
}

/**
 * Settles pending SUBS/ADD requests from the server's responses and returns the symbols of any
 * batch Schwab refused (e.g. over a subscription cap), so they can fall back to polling.
 */
export function refusedSymbols(responses: StreamResponse[], pending: Map<string, string[]>): string[] {
  const refused: string[] = []
  for (const r of responses) {
    if (r.service !== 'LEVELONE_EQUITIES' || (r.command !== 'SUBS' && r.command !== 'ADD') || !r.requestid) continue
    const batch = pending.get(r.requestid)
    if (!batch) continue
    pending.delete(r.requestid)
    if (r.content?.code !== 0) refused.push(...batch.map(fromSchwab))
  }
  return refused
}

/** ACCT_ACTIVITY rows carry a message type in field 2 (e.g. OrderFillCompleted, OrderPartialFill). */
export function accountActivityTriggers(rows: Content[] | undefined): boolean {
  // The first row after subscribing is just an acknowledgement.
  return (rows ?? []).some((r) => {
    const type = String(r[2] ?? '')
    return type !== '' && type !== 'SUBSCRIBED'
  })
}
