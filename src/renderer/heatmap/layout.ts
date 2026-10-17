import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy'
import type { Constituent } from '@shared/types'

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Tile extends Rect {
  c: Constituent
}

export interface GroupBox extends Rect {
  kind: 'sector' | 'industry'
  name: string
  sector: string
  /** Height reserved for the label strip; 0 when the box is too small to label. */
  header: number
}

export interface Layout {
  tiles: Tile[]
  groups: GroupBox[]
}

export interface Zoom {
  sector?: string
  industry?: string
}

interface Node {
  name: string
  kind?: 'sector' | 'industry'
  sector?: string
  c?: Constituent
  weight?: number
  children?: Node[]
}

export const SECTOR_HEADER = 18
export const INDUSTRY_HEADER = 14

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const t of list) {
    const k = key(t)
    const arr = m.get(k)
    arr ? arr.push(t) : m.set(k, [t])
  }
  return m
}

export function buildLayout(
  constituents: Constituent[],
  weight: (c: Constituent) => number,
  opts: { width: number; height: number; grouped: boolean; zoom: Zoom }
): Layout {
  const { width, height, grouped, zoom } = opts
  let list = constituents
  if (zoom.sector) list = list.filter((c) => c.sector === zoom.sector)
  if (zoom.industry) list = list.filter((c) => c.industry === zoom.industry)
  const leaf = (c: Constituent): Node => ({ name: c.symbol, c, weight: Math.max(weight(c), 0) })

  let root: Node
  if (!grouped) root = { name: 'root', children: list.map(leaf) }
  else if (zoom.industry)
    root = { name: 'root', children: [{ name: zoom.industry, kind: 'industry', sector: zoom.sector, children: list.map(leaf) }] }
  else {
    const industries = (items: Constituent[], sector: string): Node[] =>
      [...groupBy(items, (c) => c.industry)].map(([name, cs]) => ({ name, kind: 'industry', sector, children: cs.map(leaf) }))
    root = zoom.sector
      ? { name: 'root', children: [{ name: zoom.sector, kind: 'sector', sector: zoom.sector, children: industries(list, zoom.sector) }] }
      : {
          name: 'root',
          children: [...groupBy(list, (c) => c.sector)].map(([name, cs]) => ({
            name,
            kind: 'sector',
            sector: name,
            children: industries(cs, name)
          }))
        }
  }

  const h = hierarchy(root)
    .sum((d) => d.weight ?? 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  const header = (n: HierarchyRectangularNode<Node>): number => {
    const w = n.x1 - n.x0
    const ht = n.y1 - n.y0
    if (n.data.kind === 'sector') return w > 40 && ht > 36 ? SECTOR_HEADER : 0
    if (n.data.kind === 'industry') {
      // Industry labels only when there is room, or when the industry is all that is shown.
      const roomy = w > 110 && ht > 70
      return roomy || zoom.industry || zoom.sector ? (w > 40 && ht > 30 ? INDUSTRY_HEADER : 0) : 0
    }
    return 0
  }

  const laid = treemap<Node>()
    .tile(treemapSquarify)
    .size([width, height])
    .round(false)
    .paddingInner((n) => (n.depth === 0 ? 3 : n.data.kind === 'sector' ? 2 : 1))
    .paddingTop((n) => header(n))
    .paddingRight((n) => (n.data.kind === 'sector' ? 1 : 0))
    .paddingBottom((n) => (n.data.kind === 'sector' ? 1 : 0))
    .paddingLeft((n) => (n.data.kind === 'sector' ? 1 : 0))(h)

  const tiles: Tile[] = []
  const groups: GroupBox[] = []
  for (const n of laid.descendants()) {
    const r = { x0: n.x0, y0: n.y0, x1: n.x1, y1: n.y1 }
    if (n.data.c) {
      if (n.x1 - n.x0 > 0.5 && n.y1 - n.y0 > 0.5) tiles.push({ ...r, c: n.data.c })
    } else if (n.data.kind) {
      groups.push({ ...r, kind: n.data.kind, name: n.data.name, sector: n.data.sector ?? n.data.name, header: header(n) })
    }
  }
  return { tiles, groups }
}

const inside = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1

export type Hit = { kind: 'tile'; tile: Tile } | { kind: 'header'; group: GroupBox } | undefined

export function hitTest(layout: Layout, x: number, y: number): Hit {
  for (const t of layout.tiles) if (inside(t, x, y)) return { kind: 'tile', tile: t }
  // Prefer industry headers over the sector box that contains them.
  const headers = layout.groups.filter((g) => g.header && x >= g.x0 && x < g.x1 && y >= g.y0 && y < g.y0 + g.header)
  const hit = headers.find((g) => g.kind === 'industry') ?? headers[0]
  return hit ? { kind: 'header', group: hit } : undefined
}
