import type { Candle, Quote } from '@shared/types'
import { fromSchwab, toSchwab } from '@shared/symbols'
import { schwabGet } from './rest'
import type { Lane } from './rateLimit'
import { mergePositions, type Position, type RawAccount } from '@shared/positions'

const MD = '/marketdata/v1'

interface RawQuote {
  symbol?: string
  assetMainType?: string
  quote?: {
    lastPrice?: number
    closePrice?: number
    netChange?: number
    netPercentChange?: number
    totalVolume?: number
    regularMarketLastPrice?: number
    regularMarketNetChange?: number
    regularMarketPercentChange?: number
  }
}

export function parseQuote(symbol: string, raw: RawQuote): Quote {
  const q = raw.quote ?? {}
  const regular = q.regularMarketLastPrice
  return {
    symbol,
    last: q.lastPrice ?? regular,
    regularLast: regular,
    prevClose: q.closePrice,
    change: q.regularMarketNetChange ?? q.netChange,
    changePct: q.regularMarketPercentChange ?? q.netPercentChange,
    extPct: q.lastPrice && regular ? (q.lastPrice / regular - 1) * 100 : undefined,
    volume: q.totalVolume
  }
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function getQuotes(symbols: string[], lane: Lane = 'interactive'): Promise<Quote[]> {
  const batches = await Promise.all(
    chunk(symbols, 200).map((batch) =>
      schwabGet<Record<string, RawQuote>>(
        `${MD}/quotes`,
        { symbols: batch.map(toSchwab).join(','), fields: 'quote', indicative: false },
        { lane }
      )
    )
  )
  return batches.flatMap((b) =>
    Object.entries(b)
      .filter(([, v]) => v && v.quote)
      .map(([k, v]) => parseQuote(fromSchwab(k), v))
  )
}

interface RawInstruments {
  instruments?: { symbol: string; assetType?: string; fundamental?: { sharesOutstanding?: number; marketCap?: number } }[]
}

/** Shares outstanding per symbol; market cap is then derived from the live price. */
export async function getSharesOutstanding(symbols: string[], lane: Lane = 'interactive'): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const batches = await Promise.all(
    chunk(symbols, 100).map((batch) =>
      schwabGet<RawInstruments>(
        `${MD}/instruments`,
        { symbol: batch.map(toSchwab).join(','), projection: 'fundamental' },
        { lane }
      )
    )
  )
  for (const b of batches)
    for (const i of b.instruments ?? []) {
      const shares = i.fundamental?.sharesOutstanding
      if (shares && shares > 0) out[fromSchwab(i.symbol)] = shares
    }
  return out
}

interface RawHistory {
  candles?: { close: number; datetime: number }[]
}

export async function getDailyHistory(symbol: string): Promise<Candle[]> {
  const r = await schwabGet<RawHistory>(`${MD}/pricehistory`, {
    symbol: toSchwab(symbol),
    periodType: 'year',
    period: 1,
    frequencyType: 'daily',
    frequency: 1
  }, { lane: 'bulk' })
  return (r.candles ?? []).map((c) => ({ t: c.datetime, c: c.close }))
}

export async function getIntraday(symbol: string): Promise<Candle[]> {
  const r = await schwabGet<RawHistory>(`${MD}/pricehistory`, {
    symbol: toSchwab(symbol),
    periodType: 'day',
    period: 1,
    frequencyType: 'minute',
    frequency: 5,
    needExtendedHoursData: false
  })
  return (r.candles ?? []).map((c) => ({ t: c.datetime, c: c.close }))
}

export interface StreamerInfo {
  streamerSocketUrl: string
  schwabClientCustomerId: string
  schwabClientCorrelId: string
  schwabClientChannel: string
  schwabClientFunctionId: string
}

export async function getStreamerInfo(): Promise<StreamerInfo> {
  const r = await schwabGet<{ streamerInfo?: StreamerInfo[] }>('/trader/v1/userPreference')
  const info = r.streamerInfo?.[0]
  if (!info) throw new Error('userPreference 里没有 streamerInfo')
  return info
}

export type { Position } from '@shared/positions'

/** Equity and ETF positions across all accounts, merged by symbol. */
export async function getPositions(): Promise<Position[]> {
  return mergePositions(await schwabGet<RawAccount[]>('/trader/v1/accounts', { fields: 'positions' }))
}
