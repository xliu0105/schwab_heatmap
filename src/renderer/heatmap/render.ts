import type { Period, Quote, RefTable } from '@shared/types'
import { changePct } from '@shared/perf'
import { industryName, sectorName, type Lang } from '@shared/taxonomy'
import { bucketOf, colorFor, fmtPct } from '../colors'
import type { GroupBox, Layout, Rect, Tile } from './layout'
import type { View } from './viewport'

export const BG = '#0f0f0f'
const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif'

export interface DrawState {
  quotes: Map<string, Quote>
  refs: RefTable
  period: Period
  hoverSymbol?: string
  hoverGroup?: GroupBox
  search?: string
  legendBucket?: number
  lang: Lang
  view: View
  dpr: number
  /** Watchlist symbols, marked with a star wherever they appear. */
  watch: Set<string>
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return s.length > 1 ? `${s}…` : ''
}

// Labels are laid out in screen pixels (so zooming in reveals tickers on small tiles) and cached per
// tile for the current zoom level; prices don't affect them, so a frame only re-measures on zoom.
interface TileLabel {
  size: number
  sym: string
  pctSize: number
  pctFits: boolean
}
const tileLabels = new WeakMap<Tile, { key: number; label: TileLabel | null }>()
const headerLabels = new WeakMap<GroupBox, { key: string; text: string }>()

const zoomKey = (k: number) => Math.round(k * 20) / 20

function headerText(ctx: CanvasRenderingContext2D, g: GroupBox, lang: Lang, hovered: boolean, k: number, font: string): string {
  const key = `${lang}:${hovered}:${zoomKey(k)}`
  const hit = headerLabels.get(g)
  if (hit?.key === key) return hit.text
  const name = g.kind === 'sector' ? sectorName(g.name, lang) : industryName(g.name, lang)
  // English sector headers are upper-case like TradingView; Chinese has no case.
  const label = g.kind === 'sector' && lang === 'en' ? name.toUpperCase() : name
  ctx.font = font
  const text = fitText(ctx, hovered ? `${label} ›` : label, (g.x1 - g.x0) * k - 8)
  headerLabels.set(g, { key, text })
  return text
}

function tileLabel(ctx: CanvasRenderingContext2D, t: Tile, k: number): TileLabel | null {
  const key = zoomKey(k)
  const hit = tileLabels.get(t)
  if (hit?.key === key) return hit.label
  const w = (t.x1 - t.x0) * k
  const h = (t.y1 - t.y0) * k
  let label: TileLabel | null = null
  if (w >= 22 && h >= 14) {
    // Ticker size follows the tile: limited by width (per character) and by height.
    const symbol = t.c.symbol
    const size = Math.max(8, Math.min(44, (w - 6) / (symbol.length * 0.62 + 0.4), h / 2.4))
    const pctSize = Math.max(8, size * 0.62)
    ctx.font = `400 ${pctSize}px ${FONT}`
    // Sized for a typical worst case so the line doesn't flicker on and off as prices move.
    const pctFits = h >= size * 2.2 && ctx.measureText('+00.00%').width <= w - 6
    ctx.font = `600 ${size}px ${FONT}`
    label = { size, pctSize, pctFits, sym: pctFits ? symbol : fitText(ctx, symbol, w - 4) }
  }
  tileLabels.set(t, { key, label })
  return label
}

const headerFont = (g: GroupBox, k: number) =>
  g.kind === 'sector' ? `600 ${Math.min(11 * k, 16)}px ${FONT}` : `500 ${Math.min(10 * k, 15)}px ${FONT}`

/** Screen-space text pass for one tile; the fill was already drawn in layout space. */
function drawTileText(ctx: CanvasRenderingContext2D, t: Tile, pct: number | undefined, v: View, dim: boolean): void {
  const l = tileLabel(ctx, t, v.k)
  if (!l || !l.sym) return
  const cx = ((t.x0 + t.x1) / 2) * v.k + v.tx
  const cy = ((t.y0 + t.y1) / 2) * v.k + v.ty
  ctx.globalAlpha = dim ? 0.18 : 1
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${l.size}px ${FONT}`
  if (!l.pctFits) ctx.fillText(l.sym, cx, cy + 0.5)
  else {
    const total = l.size * 1.12 + l.pctSize
    ctx.fillText(l.sym, cx, cy - total / 2 + l.size / 2)
    ctx.font = `400 ${l.pctSize}px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.fillText(fmtPct(pct), cx, cy + total / 2 - l.pctSize / 2)
  }
  ctx.globalAlpha = 1
}

const intersects = (r: Rect, x0: number, y0: number, x1: number, y1: number) => r.x1 > x0 && r.x0 < x1 && r.y1 > y0 && r.y0 < y1

export function draw(ctx: CanvasRenderingContext2D, layout: Layout, width: number, height: number, s: DrawState): void {
  const { view: v, dpr } = s
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, width, height)

  // Only what's on screen is drawn: a deep zoom into a 6000-stock map touches a few dozen tiles.
  const vx0 = -v.tx / v.k
  const vy0 = -v.ty / v.k
  const vx1 = (width - v.tx) / v.k
  const vy1 = (height - v.ty) / v.k
  const query = s.search?.trim().toUpperCase()
  const visible: { t: Tile; pct: number | undefined; dim: boolean }[] = []
  let hoverTile: Tile | undefined

  // Pass 1, layout space: tile fills and header strips.
  ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.tx, dpr * v.ty)
  for (const t of layout.tiles) {
    if (t.c.symbol === s.hoverSymbol) hoverTile = t
    if (!intersects(t, vx0, vy0, vx1, vy1)) continue
    const pct = changePct(s.quotes.get(t.c.symbol), s.refs[t.c.symbol], s.period)
    const matchesSearch = !query || t.c.symbol.startsWith(query) || t.c.name.toUpperCase().includes(query)
    const matchesBucket = s.legendBucket === undefined || bucketOf(pct, s.period) === s.legendBucket
    const dim = !matchesSearch || !matchesBucket
    ctx.globalAlpha = dim ? 0.18 : 1
    ctx.fillStyle = colorFor(pct, s.period)
    ctx.fillRect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0)
    visible.push({ t, pct, dim })
  }
  ctx.globalAlpha = 1
  const headers = layout.groups.filter((g) => g.header && intersects({ ...g, y1: g.y0 + g.header }, vx0, vy0, vx1, vy1))
  for (const g of headers) {
    ctx.fillStyle = g === s.hoverGroup ? '#2a2e39' : g.kind === 'sector' ? BG : '#16181d'
    ctx.fillRect(g.x0, g.y0, g.x1 - g.x0, g.header)
  }

  // Pass 2, screen space: text and outlines stay crisp and constant-width at any zoom.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const { t, pct, dim } of visible) drawTileText(ctx, t, pct, v, dim)

  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#f0b90b'
  for (const { t, dim } of visible) {
    if (!s.watch.has(t.c.symbol)) continue
    const w = (t.x1 - t.x0) * v.k
    const h = (t.y1 - t.y0) * v.k
    if (w < 16 || h < 16) continue
    ctx.globalAlpha = dim ? 0.18 : 1
    ctx.font = `${Math.max(8, Math.min(14, w * 0.12))}px ${FONT}`
    ctx.fillText('★', t.x1 * v.k + v.tx - 3, t.y0 * v.k + v.ty + 2)
  }
  ctx.globalAlpha = 1
  ctx.textBaseline = 'middle'

  ctx.textAlign = 'left'
  for (const g of headers) {
    const font = headerFont(g, v.k)
    const text = headerText(ctx, g, s.lang, g === s.hoverGroup, v.k, font)
    ctx.font = font
    ctx.fillStyle = g.kind === 'sector' ? '#d1d4dc' : '#9598a1'
    ctx.fillText(text, g.x0 * v.k + v.tx + 4, (g.y0 + g.header / 2) * v.k + v.ty + 0.5)
  }

  const screen = (r: Rect, inset: number): [number, number, number, number] => [
    r.x0 * v.k + v.tx + inset,
    r.y0 * v.k + v.ty + inset,
    (r.x1 - r.x0) * v.k - inset * 2,
    (r.y1 - r.y0) * v.k - inset * 2
  ]
  // Hovering a stock outlines its whole industry, then the stock itself.
  const industry = hoverTile
    ? layout.groups.find((g) => g.kind === 'industry' && g.name === hoverTile!.c.industry && g.sector === hoverTile!.c.sector)
    : s.hoverGroup
  if (industry) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1
    ctx.strokeRect(...screen(industry, 0.5))
  }
  if (hoverTile) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.strokeRect(...screen(hoverTile, 1))
  }
}
