import { net } from 'electron'
import { lastMarketClose } from '@shared/marketTime'
import { readJson, writeJson } from '../storage'
import { parseZacksHoldings, type Holding } from './zacks'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

export interface EtfData {
  ticker: string
  name?: string
  holdings: Holding[]
  fetchedAt: number
}

export class EtfNotFound extends Error {}

const cacheFile = (t: string) => `etf/${t}.json`

async function fetchEtf(ticker: string): Promise<EtfData> {
  // Schwab has no fund-holdings endpoint; Zacks' holdings page embeds the full list with weights.
  const res = await net.fetch(`https://www.zacks.com/funds/etf/${encodeURIComponent(ticker)}/holding`, {
    headers: { 'User-Agent': UA }
  })
  // Unknown tickers get redirected to the site search instead of a holdings page (and anything
  // without holdings data below is treated the same way).
  if (res.redirected && !/\/funds\/etf\/[^/]+\/holding/i.test(res.url)) throw new EtfNotFound(ticker)
  if (!res.ok) throw new Error(`Zacks HTTP ${res.status}`)
  const { name, holdings } = parseZacksHoldings(await res.text())
  if (!holdings.length) throw new EtfNotFound(ticker)
  return { ticker, name, holdings, fetchedAt: Date.now() }
}

/**
 * Holdings for one ETF. Fund files change at most daily, so the cache is reused until the next
 * market close; if a refresh fails the previous copy is returned rather than an empty map.
 */
export async function getEtf(ticker: string, force = false): Promise<EtfData> {
  const cached = readJson<EtfData | undefined>(cacheFile(ticker), undefined)
  if (cached && !force && cached.fetchedAt >= lastMarketClose(Date.now())) return cached
  try {
    const fresh = await fetchEtf(ticker)
    writeJson(cacheFile(ticker), fresh)
    return fresh
  } catch (e) {
    if (cached && !(e instanceof EtfNotFound)) return cached
    throw e
  }
}

/** Display names of ETFs already fetched once (for the universe menu). */
export function etfNames(tickers: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of tickers) {
    const name = readJson<EtfData | undefined>(cacheFile(t), undefined)?.name
    if (name) out[t] = name
  }
  return out
}
