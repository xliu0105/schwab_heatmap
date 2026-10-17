import { describe, expect, it } from 'vitest'
import { singleFlight, subscriptionOrder } from '@shared/streamOrder'

describe('subscriptionOrder', () => {
  it('puts the benchmark first, then biggest caps first', () => {
    const caps: Record<string, number> = { A: 10, B: 300, C: 50 }
    expect(subscriptionOrder(['A', 'B', 'C', '$COMPX'], '$COMPX', (s) => caps[s])).toEqual(['$COMPX', 'B', 'C', 'A'])
    expect(subscriptionOrder(['A', 'B'], undefined, (s) => caps[s])).toEqual(['B', 'A'])
  })
})

describe('singleFlight', () => {
  it('skips calls made while the previous one is still running', async () => {
    let runs = 0
    let release!: () => void
    const poll = singleFlight(async () => {
      runs++
      await new Promise<void>((r) => (release = r))
    })
    const first = poll()
    await poll()
    expect(runs).toBe(1)
    release()
    await first
    const third = poll()
    release()
    await third
    expect(runs).toBe(2)
  })
})
