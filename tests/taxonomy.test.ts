import { describe, expect, it } from 'vitest'
import { classifyNasdaq, hasIndustryZh, industryName, knownSectors, NASDAQ_INDUSTRY, OTHER, sectorName } from '@shared/taxonomy'
import sp500 from '../resources/universes/sp500.json'

describe('taxonomy', () => {
  it('maps every Nasdaq industry onto a known GICS sector with a Chinese name', () => {
    for (const [k, [sector, industry]] of Object.entries(NASDAQ_INDUSTRY)) {
      expect(knownSectors(), k).toContain(sector)
      expect(hasIndustryZh(industry), `${k} → ${industry}`).toBe(true)
    }
  })
  it('has Chinese names for every sector and sub-industry in the S&P 500 snapshot', () => {
    for (const c of sp500 as { sector: string; industry: string }[]) {
      expect(sectorName(c.sector, 'zh'), c.sector).not.toBe(c.sector)
      expect(hasIndustryZh(c.industry), c.industry).toBe(true)
    }
  })
  it('uses the sector-specific override before the plain industry', () => {
    expect(classifyNasdaq('Telecommunications', 'Telecommunications Equipment').sector).toBe('Communication Services')
    expect(classifyNasdaq('Consumer Discretionary', 'Telecommunications Equipment').sector).toBe('Information Technology')
  })
  it('trims padded industry names', () => {
    expect(classifyNasdaq('Health Care', ' Medicinal Chemicals and Botanical Products ').industry).toBe('Pharmaceuticals')
  })
  it('keeps the sector and parks the industry when unmapped', () => {
    expect(classifyNasdaq('Technology', 'Brand New Industry')).toEqual({ sector: 'Information Technology', industry: OTHER, mapped: false })
    expect(classifyNasdaq('', '')).toEqual({ sector: OTHER, industry: OTHER, mapped: true })
  })
  it('translates names for display', () => {
    expect(sectorName('Financials', 'zh')).toBe('金融')
    expect(sectorName('Financials', 'en')).toBe('Financials')
    expect(industryName('Diversified Banks', 'zh')).toBe('综合性银行')
  })
})
