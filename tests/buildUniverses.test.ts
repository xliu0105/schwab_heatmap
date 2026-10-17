import { afterEach, describe, expect, it, vi } from 'vitest'
import { dowFromTickerTable, nasdaqIndex } from '../src/main/data/buildUniverses'

describe('dowFromTickerTable', () => {
  it('reads Company/Ticker tables and strips exchange prefixes', () => {
    const html = `<table class="wikitable sortable"><tr><th>Company</th><th>Ticker</th><th>Sector</th></tr>
      <tr><td><a>FedEx</a></td><td>NYSE: FDX</td><td>Delivery</td></tr>
      <tr><td>Alaska Air Group</td><td><a>ALK</a></td><td>Airline</td></tr></table>`
    expect(dowFromTickerTable(html)).toEqual([
      { symbol: 'FDX', name: 'FedEx' },
      { symbol: 'ALK', name: 'Alaska Air Group' }
    ])
  })
})

describe('nasdaqIndex', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('walks back over empty trade dates until it finds members', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        calls.push(init.body.get('tradeDate')!)
        const data = calls.length < 3 ? [] : [{ Symbol: 'BRK/B', Name: 'Berkshire' }]
        return new Response(JSON.stringify({ aaData: data }))
      })
    )
    expect(await nasdaqIndex('BKX')).toEqual([{ symbol: 'BRK.B', name: 'Berkshire' }])
    expect(calls).toHaveLength(3)
  })
})
