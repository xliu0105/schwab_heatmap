import { describe, expect, it } from 'vitest'
import { EARLY_SHOW_COVERAGE, priceCoverage } from '@shared/coverage'

describe('priceCoverage', () => {
  it('shows a map early only when nearly every price is known', () => {
    const known = new Set(Array.from({ length: 90 }, (_, i) => `S${i}`))
    const all = Array.from({ length: 100 }, (_, i) => `S${i}`)
    expect(priceCoverage(all, (s) => known.has(s))).toBeGreaterThanOrEqual(EARLY_SHOW_COVERAGE)
    expect(priceCoverage([...all, 'X1', 'X2'], (s) => known.has(s))).toBeLessThan(EARLY_SHOW_COVERAGE)
    expect(priceCoverage([], () => true)).toBe(0)
  })
})

import { shouldShowEarly } from '@shared/coverage'
import { DEFAULT_PREFS, withDefaults } from '@shared/settingsMerge'

describe('shouldShowEarly', () => {
  it('always waits for fresh quotes unless instant switching is on', () => {
    expect(shouldShowEarly(false, 1)).toBe(false)
    expect(shouldShowEarly(true, 0.95)).toBe(true)
    expect(shouldShowEarly(true, 0.5)).toBe(false)
  })
  it('defaults to waiting, also for settings saved before the option existed', () => {
    expect(DEFAULT_PREFS.instantSwitch).toBe(false)
    expect(withDefaults({ prefs: { lang: 'en' } as never }).prefs.instantSwitch).toBe(false)
  })
})
