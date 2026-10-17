import { describe, expect, it } from 'vitest'
import { fromFs, fromFsFields, toFs, toFsFields } from '../src/main/cloud/firestoreCodec'
import { CloudError, googleAuthUrl, parseCallback, pkceChallenge, pkcePair } from '../src/main/cloud/oauthUtil'
import { DEFAULT_ETFS, DEFAULT_PREFS, mergeSettings, withDefaults } from '@shared/settingsMerge'
import type { SyncedSettings } from '@shared/types'

describe('PKCE', () => {
  it('matches the RFC 7636 test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('generates URL-safe verifiers of the required length', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(challenge).toBe(pkceChallenge(verifier))
  })
  it('builds the Google auth URL with PKCE and the loopback redirect', () => {
    const url = new URL(googleAuthUrl('cid', 'http://127.0.0.1:5000', 'chal', 'st'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:5000',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      scope: 'openid email profile'
    })
  })
})

describe('parseCallback', () => {
  it('returns the code when state matches', () => {
    expect(parseCallback('/?state=abc&code=4%2F0Ab', 'abc')).toEqual({ code: '4/0Ab' })
  })
  it('rejects a mismatched state', () => {
    expect(() => parseCallback('/?state=evil&code=x', 'abc')).toThrow(CloudError)
  })
  it('reports a cancelled consent', () => {
    try {
      parseCallback('/?error=access_denied&state=abc', 'abc')
      expect.unreachable()
    } catch (e) {
      expect((e as CloudError).key).toBe('cancelled')
    }
  })
})

describe('Firestore codec', () => {
  it('round-trips nested values', () => {
    const v = { watchlist: ['AAPL', 'BRK.B'], prefs: { lang: 'en', grouped: false, n: 3, x: 1.5, none: null }, updatedAt: 1792240000000 }
    expect(fromFsFields(toFsFields(v))).toEqual(v)
  })
  it('uses Firestore integer and double types', () => {
    expect(toFs(42)).toEqual({ integerValue: '42' })
    expect(toFs(0.5)).toEqual({ doubleValue: 0.5 })
    expect(fromFs({ integerValue: '1792240000000' })).toBe(1792240000000)
  })
  it('reads empty arrays and maps the API omits', () => {
    expect(fromFs({ arrayValue: {} })).toEqual([])
    expect(fromFs({ mapValue: {} })).toEqual({})
  })
})

const s = (watchlist: string[], updatedAt: number, prefs = DEFAULT_PREFS, etfs = DEFAULT_ETFS): SyncedSettings => ({ watchlist, etfs, prefs, updatedAt })

describe('mergeSettings', () => {
  const now = 5000
  it('uploads the local copy when the cloud has none', () => {
    const local = s(['AAPL'], 100)
    expect(mergeSettings(local, undefined, true, now)).toEqual({ settings: local, push: true, changed: false })
  })
  it('unions watchlists on first sign-in and keeps cloud prefs', () => {
    const local = s(['TSLA', 'AAPL'], 900)
    const remote = s(['AAPL', 'NVDA'], 100, { ...DEFAULT_PREFS, lang: 'en' })
    const r = mergeSettings(local, remote, true, now)
    expect(r.settings).toEqual({ watchlist: ['AAPL', 'NVDA', 'TSLA'], etfs: DEFAULT_ETFS, prefs: remote.prefs, updatedAt: now })
    expect(r.push).toBe(true)
    expect(r.changed).toBe(true)
  })
  it('takes the cloud copy as-is on first sign-in when it already has everything', () => {
    const remote = s(['AAPL', 'NVDA'], 100)
    const r = mergeSettings(s(['NVDA'], 900), remote, true, now)
    expect(r).toEqual({ settings: remote, push: false, changed: true })
  })
  it('lets the newer copy win afterwards', () => {
    expect(mergeSettings(s(['A'], 100), s(['B'], 200), false, now)).toEqual({ settings: s(['B'], 200), push: false, changed: true })
    expect(mergeSettings(s(['A'], 300), s(['B'], 200), false, now)).toEqual({ settings: s(['A'], 300), push: true, changed: false })
  })
  it('unions ETF lists on first sign-in too', () => {
    const r = mergeSettings(s([], 900, DEFAULT_PREFS, ['SMH', 'XLK']), s([], 100, DEFAULT_PREFS, ['VOO', 'SMH']), true, now)
    expect(r.settings.etfs).toEqual(['VOO', 'SMH', 'XLK'])
    expect(r.push).toBe(true)
  })
  it('does nothing when both copies are the same age', () => {
    expect(mergeSettings(s(['A'], 200), s(['A'], 200), false, now)).toMatchObject({ push: false, changed: false })
  })
})

describe('withDefaults', () => {
  it('fills missing prefs and cleans the watchlist (legacy config migration)', () => {
    expect(withDefaults({ watchlist: [' aapl', 'brk/b', 'AAPL', ''] })).toEqual({
      watchlist: ['AAPL', 'BRK.B'],
      etfs: DEFAULT_ETFS,
      prefs: DEFAULT_PREFS,
      updatedAt: 0
    })
    expect(withDefaults({ prefs: { lang: 'en' } as never }).prefs).toEqual({ ...DEFAULT_PREFS, lang: 'en' })
  })
})
