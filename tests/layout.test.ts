import { describe, expect, it } from 'vitest'
import type { Constituent } from '@shared/types'
import { buildLayout, hitTest } from '../src/renderer/heatmap/layout'

const cs: Constituent[] = [
  { symbol: 'AAPL', name: 'Apple', sector: 'Tech', industry: 'Hardware' },
  { symbol: 'DELL', name: 'Dell', sector: 'Tech', industry: 'Hardware' },
  { symbol: 'NVDA', name: 'Nvidia', sector: 'Tech', industry: 'Semis' },
  { symbol: 'AMD', name: 'AMD', sector: 'Tech', industry: 'Semis' },
  { symbol: 'XOM', name: 'Exxon', sector: 'Energy', industry: 'Oil' },
  { symbol: 'CVX', name: 'Chevron', sector: 'Energy', industry: 'Oil' }
]
const caps: Record<string, number> = { AAPL: 300, DELL: 10, NVDA: 280, AMD: 30, XOM: 50, CVX: 30 }
const weight = (c: Constituent) => caps[c.symbol]
const area = (r: { x0: number; y0: number; x1: number; y1: number }) => (r.x1 - r.x0) * (r.y1 - r.y0)
const opts = { width: 1000, height: 600, grouped: true, zoom: {} }

describe('buildLayout', () => {
  it('places every stock inside the canvas', () => {
    const { tiles } = buildLayout(cs, weight, opts)
    expect(tiles.map((t) => t.c.symbol).sort()).toEqual(cs.map((c) => c.symbol).sort())
    for (const t of tiles) {
      expect(t.x0).toBeGreaterThanOrEqual(0)
      expect(t.y1).toBeLessThanOrEqual(600)
    }
  })
  it('sizes tiles by weight', () => {
    const { tiles } = buildLayout(cs, weight, opts)
    const a = (s: string) => area(tiles.find((t) => t.c.symbol === s)!)
    expect(a('AAPL')).toBeGreaterThan(a('NVDA'))
    expect(a('NVDA')).toBeGreaterThan(a('XOM'))
    expect(a('XOM')).toBeGreaterThan(a('DELL'))
  })
  it('nests stocks inside their sector and industry boxes', () => {
    const { tiles, groups } = buildLayout(cs, weight, opts)
    for (const t of tiles) {
      const sector = groups.find((g) => g.kind === 'sector' && g.name === t.c.sector)!
      const industry = groups.find((g) => g.kind === 'industry' && g.name === t.c.industry)!
      for (const box of [sector, industry]) {
        expect(t.x0).toBeGreaterThanOrEqual(box.x0)
        expect(t.x1).toBeLessThanOrEqual(box.x1 + 1e-6)
        expect(t.y0).toBeGreaterThanOrEqual(box.y0 + box.header - 1e-6)
      }
    }
  })
  it('zooms into a sector or industry', () => {
    expect(buildLayout(cs, weight, { ...opts, zoom: { sector: 'Energy' } }).tiles.map((t) => t.c.symbol).sort()).toEqual(['CVX', 'XOM'])
    expect(buildLayout(cs, weight, { ...opts, zoom: { sector: 'Tech', industry: 'Semis' } }).tiles).toHaveLength(2)
  })
  it('lays out a flat map without groups', () => {
    const { tiles, groups } = buildLayout(cs, weight, { ...opts, grouped: false })
    expect(tiles).toHaveLength(6)
    expect(groups).toHaveLength(0)
  })
  it('hit-tests tiles and sector headers', () => {
    const layout = buildLayout(cs, weight, opts)
    const t = layout.tiles[0]
    const hit = hitTest(layout, (t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2)
    expect(hit?.kind === 'tile' && hit.tile.c.symbol).toBe(t.c.symbol)
    const sector = layout.groups.find((g) => g.kind === 'sector' && g.header)!
    const head = hitTest(layout, sector.x0 + 5, sector.y0 + 3)
    expect(head?.kind === 'header' && head.group.name).toBe(sector.name)
  })
})
