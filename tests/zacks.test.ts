import { describe, expect, it } from 'vitest'
import { parseZacksHoldings } from '../src/main/data/zacks'

// Trimmed copy of the real page structure (QQQM, 2026-10).
const row = (sym: string, name: string, w: string) =>
  [name, `<button class="modal_external" rel="${sym}">${sym} Quick Quote</button><a href="//www.zacks.com/funds/etf/${sym}" rel="${sym}"><span class="hoverquote-symbol">${sym}</span></a>`, '1,000', w, '17.78', '<a></a>']
const page = `<html><head><title>QQQM - INVESCO NASDAQ 100 ETF - Holdings - Zacks.com</title></head><body><script>
etf_holdings.formatted_data = ${JSON.stringify([
  row('NVDA', 'NVIDIA Corp', '8.44'),
  row('BRK/B', 'Berkshire Hathaway', '1.20'),
  ['<span class="truncated_text_single" title="Warner Bros Discovery Inc">Warner Bros Dis..</span>', 'WBD', '11,585,557', '0.32', 'NA', 'NA'],
  ['<span class="truncated_text_single" title="CME E-Mini NASDAQ 100 Index Future">CME E-Mini NASD..</span>', 'NQZ6', '225', '0.13', 'NA', 'NA'],
  ['Bad row', '', '', 'NA', '', '']
])};
</script></body></html>`

describe('parseZacksHoldings', () => {
  const r = parseZacksHoldings(page)
  it('reads the fund name from the title', () => {
    expect(r.name).toBe('Invesco Nasdaq 100 ETF')
  })
  it('reads linked rows with symbol and weight', () => {
    expect(r.holdings[0]).toEqual({ symbol: 'NVDA', name: 'NVIDIA Corp', weight: 8.44, linked: true })
    expect(r.holdings[1].symbol).toBe('BRK.B')
  })
  it('keeps plain-text rows but marks them unlinked, with the full name', () => {
    expect(r.holdings[2]).toEqual({ symbol: 'WBD', name: 'Warner Bros Discovery Inc', weight: 0.32, linked: false })
    expect(r.holdings[3]).toMatchObject({ symbol: 'NQZ6', linked: false })
  })
  it('skips rows without a symbol or weight', () => {
    expect(r.holdings).toHaveLength(4)
  })
  it('returns no holdings for pages without data', () => {
    expect(parseZacksHoldings('<title>Search - Zacks.com</title>').holdings).toEqual([])
  })
})
