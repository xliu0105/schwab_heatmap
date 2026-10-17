import { describe, expect, it } from 'vitest'
import { NO_DATA, STEPS, bucketOf, colorFor, legendLabels } from '../src/renderer/colors'

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

describe('colors', () => {
  it('maps the scale endpoints and clamps beyond them', () => {
    expect(colorFor(-3, '1D')).toBe(rgb(STEPS[0][1]))
    expect(colorFor(0, '1D')).toBe(rgb(STEPS[3][1]))
    expect(colorFor(9, '1D')).toBe(rgb(STEPS[6][1]))
  })
  it('scales with the period', () => {
    expect(colorFor(30, 'YTD')).toBe(colorFor(3, '1D'))
  })
  it('uses the no-data color for missing values', () => {
    expect(colorFor(undefined, '1D')).toBe(NO_DATA)
    expect(colorFor(NaN, '1D')).toBe(NO_DATA)
  })
  it('buckets changes for legend hover', () => {
    expect(bucketOf(0.2, '1D')).toBe(3)
    expect(bucketOf(-2.6, '1D')).toBe(0)
    expect(bucketOf(1.4, '1D')).toBe(4)
    expect(bucketOf(undefined, '1D')).toBeUndefined()
  })
  it('labels the legend in period units', () => {
    expect(legendLabels('1D')).toEqual(['-3%', '-2%', '-1%', '0%', '+1%', '+2%', '+3%'])
    expect(legendLabels('1M')[6]).toBe('+10%')
  })
})
