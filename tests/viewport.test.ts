import { describe, expect, it } from 'vitest'
import { clampView, IDENTITY, interpolate, MAX_ZOOM, panBy, toWorld, wheelPixels, zoomAt } from '../src/renderer/heatmap/viewport'

const W = 1000
const H = 600

describe('viewport', () => {
  it('keeps the point under the cursor fixed while zooming', () => {
    const before = toWorld(IDENTITY, 300, 200)
    const v = zoomAt(IDENTITY, 2.5, 300, 200, W, H)
    const after = toWorld(v, 300, 200)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
  it('round-trips screen → world → screen', () => {
    const v = { k: 3, tx: -400, ty: -250 }
    const p = toWorld(v, 123, 456)
    expect(p.x * v.k + v.tx).toBeCloseTo(123)
    expect(p.y * v.k + v.ty).toBeCloseTo(456)
  })
  it('never zooms out past 1× and resets panning there', () => {
    expect(clampView({ k: 0.5, tx: -30, ty: 20 }, W, H)).toEqual(IDENTITY)
    expect(zoomAt({ k: 2, tx: -500, ty: -300 }, 0.1, 10, 10, W, H)).toEqual(IDENTITY)
  })
  it('caps the zoom level', () => {
    expect(zoomAt(IDENTITY, 100, 0, 0, W, H).k).toBe(MAX_ZOOM)
  })
  it('stops panning at the edges so no empty margin shows', () => {
    const v = { k: 2, tx: 0, ty: 0 }
    expect(panBy(v, 200, 200, W, H)).toEqual({ k: 2, tx: 0, ty: 0 })
    expect(panBy(v, -5000, -5000, W, H)).toEqual({ k: 2, tx: W - 2 * W, ty: H - 2 * H })
  })

  it('animates a centred zoom without ever dipping below the start or moving the centre', () => {
    const to = zoomAt(IDENTITY, 1.5, W / 2, H / 2, W, H)
    let prevK = 1
    for (const u of [-0.3, 0, 0.1, 0.25, 0.5, 0.75, 1, 1.2]) {
      const v = interpolate(IDENTITY, to, u, W, H)
      expect(v.k).toBeGreaterThanOrEqual(prevK - 1e-9)
      expect(v.k).toBeLessThanOrEqual(1.5 + 1e-9)
      const c = toWorld(v, W / 2, H / 2)
      expect(c.x).toBeCloseTo(W / 2)
      expect(c.y).toBeCloseTo(H / 2)
      prevK = v.k
    }
  })
  it('ends exactly on both endpoints', () => {
    const a = { k: 3, tx: -900, ty: -400 }
    expect(interpolate(a, IDENTITY, 1, W, H)).toEqual({ k: 1, tx: 0, ty: 0 })
    const start = interpolate(a, IDENTITY, 0, W, H)
    expect(start.k).toBeCloseTo(3)
    expect(start.tx).toBeCloseTo(-900)
  })
  it('converts line- and page-based wheel deltas to pixels', () => {
    expect(wheelPixels(3, 1, 800)).toBe(48)
    expect(wheelPixels(1, 2, 800)).toBe(800)
    expect(wheelPixels(-120, 0, 800)).toBe(-120)
  })
})
