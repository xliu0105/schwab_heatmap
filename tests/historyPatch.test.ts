import { describe, expect, it } from 'vitest'
import { FULL_REFRESH_MS, patchFromQuote } from '@shared/historyPatch'
import { nextOpenAfter, previousClose, sessionDate } from '@shared/marketTime'

// Schwab daily bars are stamped at New York midnight.
const bar = (day: string, c: number) => ({ t: Date.parse(`${day}T04:00:00Z`), c })
const q = (prevClose: number, regularLast: number) => ({ symbol: 'X', prevClose, regularLast })
const fetchedMon = Date.parse('2026-10-19T21:30:00Z') // Mon evening, after Monday's close
const EVENING = Date.parse('2026-10-20T22:00:00Z') // Tue 18:00 EDT: Tuesday closed
const SESSION = Date.parse('2026-10-21T15:00:00Z') // Wed 11:00 EDT: Wednesday trading
const entry = { fetchedAt: fetchedMon, candles: [bar('2026-10-16', 98), bar('2026-10-19', 100)] }

describe('market clock helpers', () => {
  it('reads New York dates and skips weekends', () => {
    expect(sessionDate(Date.parse('2026-10-20T03:30:00Z'))).toBe('2026-10-19')
    expect(sessionDate(previousClose(Date.parse('2026-10-19T20:00:00Z')))).toBe('2026-10-16')
  })
  it('handles the switch to standard time', () => {
    expect(sessionDate(previousClose(Date.parse('2026-11-02T21:00:00Z')))).toBe('2026-10-30')
  })
  it('finds the next open, over weekends too', () => {
    expect(new Date(nextOpenAfter(Date.parse('2026-10-20T20:00:00Z'))).toISOString()).toBe('2026-10-21T13:30:00.000Z')
    expect(new Date(nextOpenAfter(Date.parse('2026-10-16T20:00:00Z'))).toISOString()).toBe('2026-10-19T13:30:00.000Z')
  })
})

describe('patchFromQuote', () => {
  it('after the close, appends the regular-session last price, checked against the prior close', () => {
    const r = patchFromQuote(entry, q(100, 103), EVENING)!
    expect(r.candles.map((c) => [sessionDate(c.t), c.c])).toEqual([
      ['2026-10-16', 98],
      ['2026-10-19', 100],
      ['2026-10-20', 103]
    ])
    expect(r.fullAt).toBe(fetchedMon)
  })
  it('after the close, refuses when the prior close disagrees (split)', () => {
    expect(patchFromQuote(entry, q(50, 51.5), EVENING)).toBeUndefined()
  })
  it('after the close, accepts a previous-close field that already rolled to the latest close', () => {
    expect(patchFromQuote(entry, q(103, 103), EVENING)!.candles.at(-1)!.c).toBe(103)
  })
  it('during the next session, takes the latest close from the previous-close field, not the live price', () => {
    // Wednesday 11:00: Tuesday closed at 103, live price 106.
    const r = patchFromQuote(entry, q(103, 106), Date.parse('2026-10-20T15:00:00Z') + 86_400_000)!
    expect(sessionDate(r.candles.at(-1)!.t)).toBe('2026-10-20')
    expect(r.candles.at(-1)!.c).toBe(103)
  })
  it('replaces a partial bar fetched during the latest session', () => {
    const mid = { fetchedAt: Date.parse('2026-10-20T15:00:00Z'), candles: [bar('2026-10-19', 100), bar('2026-10-20', 101.5)] }
    expect(patchFromQuote(mid, q(100, 103), EVENING)!.candles.map((c) => c.c)).toEqual([100, 103])
  })
  it('refuses gaps longer than one session', () => {
    const stale = { fetchedAt: Date.parse('2026-10-15T21:00:00Z'), candles: [bar('2026-10-15', 100)] }
    expect(patchFromQuote(stale, q(100, 103), EVENING)).toBeUndefined()
    expect(patchFromQuote(stale, q(103, 106), SESSION)).toBeUndefined()
  })
  it('forces a full refresh once a week', () => {
    const old = { ...entry, fullAt: EVENING - FULL_REFRESH_MS - 1 }
    expect(patchFromQuote(old, q(100, 103), EVENING)).toBeUndefined()
  })
  it('needs a cache and a quote, and leaves fresh entries alone', () => {
    expect(patchFromQuote(undefined, q(100, 103), EVENING)).toBeUndefined()
    expect(patchFromQuote(entry, undefined, EVENING)).toBeUndefined()
    const fresh = { ...entry, fetchedAt: EVENING }
    expect(patchFromQuote(fresh, q(100, 103), EVENING)).toBe(fresh)
  })
})

import { prioritize } from '@shared/historyPatch'

describe('prioritize', () => {
  it('puts the new universe first, keeps the old backlog, and never duplicates', () => {
    expect(prioritize(['A', 'B', 'C'], ['X', 'B', 'Y'], ['Z', 'A'], new Set(['Y']))).toEqual(['X', 'B', 'A', 'C', 'Z'])
  })
})
