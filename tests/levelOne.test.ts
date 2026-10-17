import { describe, expect, it } from 'vitest'
import { F, parseLevelOne } from '../src/main/schwab/levelOne'

describe('parseLevelOne', () => {
  it('maps full rows', () => {
    const q = parseLevelOne({ key: 'BRK/B', [F.last]: 101, [F.close]: 100, [F.volume]: 5000, [F.regularPct]: 1, [F.regularLast]: 101 })
    expect(q).toMatchObject({ symbol: 'BRK.B', last: 101, prevClose: 100, volume: 5000, changePct: 1, extPct: 0 })
  })
  it('keeps partial ticks partial', () => {
    const q = parseLevelOne({ key: 'AAPL', [F.volume]: 7 })!
    expect(q).toEqual({ symbol: 'AAPL', volume: 7 })
  })
  it('derives extended-hours change from the remembered regular close', () => {
    const q = parseLevelOne({ key: 'AAPL', [F.last]: 110 }, 100)!
    expect(q.extPct).toBeCloseTo(10)
  })
  it('prefers regular-session percent over the all-session one', () => {
    expect(parseLevelOne({ key: 'A', [F.netPct]: 3, [F.regularPct]: 2 })!.changePct).toBe(2)
    expect(parseLevelOne({ key: 'A', [F.netPct]: 3 })!.changePct).toBe(3)
  })
  it('ignores rows without a key', () => {
    expect(parseLevelOne({})).toBeUndefined()
  })
})

import { refusedSymbols } from '../src/main/schwab/levelOne'

describe('refusedSymbols', () => {
  it('returns symbols of refused batches and settles every answered request', () => {
    const pending = new Map([
      ['1', ['AAPL', 'BRK/B']],
      ['2', ['MSFT']],
      ['3', ['NVDA']]
    ])
    const refused = refusedSymbols(
      [
        { service: 'LEVELONE_EQUITIES', command: 'SUBS', requestid: '1', content: { code: 0 } },
        { service: 'LEVELONE_EQUITIES', command: 'ADD', requestid: '2', content: { code: 19, msg: 'limit' } },
        { service: 'ADMIN', command: 'LOGIN', requestid: '3', content: { code: 0 } }
      ],
      pending
    )
    expect(refused).toEqual(['MSFT'])
    expect([...pending.keys()]).toEqual(['3'])
  })
})

import { accountActivityTriggers } from '../src/main/schwab/levelOne'

describe('accountActivityTriggers', () => {
  it('fires on order events but not on the subscription acknowledgement', () => {
    expect(accountActivityTriggers([{ key: 'Account Activity', 1: '', 2: 'SUBSCRIBED', 3: '' }])).toBe(false)
    expect(accountActivityTriggers([{ key: 'Account Activity', 1: '123', 2: 'OrderFillCompleted', 3: '{}' }])).toBe(true)
    expect(accountActivityTriggers(undefined)).toBe(false)
  })
})
