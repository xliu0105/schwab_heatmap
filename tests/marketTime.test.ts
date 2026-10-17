import { describe, expect, it } from 'vitest'
import { lastMarketClose } from '@shared/marketTime'

const iso = (t: number) => new Date(t).toISOString()

describe('lastMarketClose', () => {
  it('returns the same day close once the market has closed (EDT)', () => {
    // Fri 2026-10-16 17:00 EDT = 21:00Z; close was 20:00Z.
    expect(iso(lastMarketClose(Date.parse('2026-10-16T21:00:00Z')))).toBe('2026-10-16T20:00:00.000Z')
  })
  it('returns the previous weekday close during the session', () => {
    // Fri 11:00 EDT → Thursday's close.
    expect(iso(lastMarketClose(Date.parse('2026-10-16T15:00:00Z')))).toBe('2026-10-15T20:00:00.000Z')
  })
  it('skips weekends', () => {
    // Sat and Mon morning both map back to Friday's close.
    expect(iso(lastMarketClose(Date.parse('2026-10-17T12:00:00Z')))).toBe('2026-10-16T20:00:00.000Z')
    expect(iso(lastMarketClose(Date.parse('2026-10-19T13:00:00Z')))).toBe('2026-10-16T20:00:00.000Z')
  })
  it('follows standard time after the DST switch (EST close is 21:00Z)', () => {
    expect(iso(lastMarketClose(Date.parse('2026-11-10T22:00:00Z')))).toBe('2026-11-10T21:00:00.000Z')
  })
})
