import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Constituent, Period, Quote, RefTable, SizeBy } from '@shared/types'
import { buildLayout, hitTest, type GroupBox, type Hit, type Zoom } from './layout'
import { draw } from './render'
import { Tooltip } from './Tooltip'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { useT } from '../i18n'
import { IDENTITY, interpolate, MAX_ZOOM, panBy, toWorld, wheelPixels, zoomAt, type View } from './viewport'

interface Props {
  constituents: Constituent[]
  quotes: Map<string, Quote>
  refs: RefTable
  version: number
  layoutEpoch: number
  period: Period
  sizeBy: SizeBy
  grouped: boolean
  zoom: Zoom
  search: string
  legendBucket?: number
  watch: Set<string>
  /** How a constituent's weight reads in the tooltip. */
  weightKind: 'etf' | 'holdings'
  onZoom(z: Zoom): void
  onWatchAdd(symbol: string): void
  onWatchRemove(symbol: string): void
}

export interface HeatmapHandle {
  toDataUrl(): string | undefined
}

function weigher(constituents: Constituent[], quotes: Map<string, Quote>, sizeBy: SizeBy): (c: Constituent) => number {
  const raw = (c: Constituent): number | undefined => {
    const q = quotes.get(c.symbol)
    switch (sizeBy) {
      case 'equal':
        return 1
      case 'marketCap':
        return q?.marketCap
      case 'volume':
        return q?.volume
      case 'dollarVolume':
        return q?.volume && q.last ? q.volume * q.last : undefined
      case 'weight':
        return c.weight
    }
  }
  // Symbols without data still get a visible tile: the median of the known values.
  const sorted = constituents
    .map(raw)
    .filter((v): v is number => !!v && v > 0).sort((a, b) => a - b)
  const fallback = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1
  return (c) => {
    const v = raw(c)
    return v && v > 0 ? v : fallback
  }
}

export const Heatmap = forwardRef<HeatmapHandle, Props>(function Heatmap(p, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number }>()
  const frame = useRef(0)
  const { lang, t } = useT()
  const [view, setViewState] = useState<View>(IDENTITY)
  const viewRef = useRef(view)
  const setView = useCallback((v: View) => {
    viewRef.current = v
    setViewState(v)
  }, [])
  const anim = useRef(0)
  const wheel = useRef<{ targetK: number; cx: number; cy: number; raf: number }>({ targetK: 1, cx: 0, cy: 0, raf: 0 })
  const stopMotion = useCallback(() => {
    cancelAnimationFrame(anim.current)
    cancelAnimationFrame(wheel.current.raf)
    anim.current = 0
    wheel.current.raf = 0
  }, [])
  const drag = useRef<{ x: number; y: number; start: View; moved: boolean }>()
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>()
  const closeMenu = useCallback(() => setMenu(undefined), [])

  useImperativeHandle(ref, () => ({ toDataUrl: () => canvasRef.current?.toDataURL('image/png') }))

  useEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Layout is frozen between explicit changes so tiles don't jitter as prices tick.
  const pendingDrawTiming = useRef<number>()
  const layout = useMemo(
    () => {
      if (!size.w || !size.h) return { tiles: [], groups: [] }
      const t0 = performance.now()
      const l = buildLayout(p.constituents, weigher(p.constituents, p.quotes, p.sizeBy), { width: size.w, height: size.h, grouped: p.grouped, zoom: p.zoom })
      window.api.perf('layout', { tiles: l.tiles.length, ms: Math.round(performance.now() - t0) })
      pendingDrawTiming.current = l.tiles.length
      return l
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.constituents, p.sizeBy, p.grouped, p.zoom, size.w, size.h, p.layoutEpoch]
  )

  // A new map (other universe, drill level, grouping, sizing, window size) starts unzoomed; the
  // periodic relayout doesn't, so a zoomed-in view stays put while you look at it.
  useEffect(() => {
    stopMotion()
    setView(IDENTITY)
  }, [p.constituents, p.sizeBy, p.grouped, p.zoom, size.w, size.h, setView, stopMotion])

  /** Button and keyboard zooms ease over ~220ms. */
  const animateTo = useCallback(
    (target: View) => {
      stopMotion()
      const from = viewRef.current
      // Time from the first frame, not from now: rAF timestamps can predate this call, and a
      // negative progress would make the ease run backwards (the map shrank before growing).
      let t0: number | undefined
      const step = (now: number) => {
        t0 ??= now
        const u = Math.min(1, (now - t0) / 220)
        setView(u >= 1 ? target : interpolate(from, target, 1 - (1 - u) ** 3, size.w, size.h))
        if (u < 1) anim.current = requestAnimationFrame(step)
      }
      anim.current = requestAnimationFrame(step)
    },
    [setView, stopMotion, size]
  )
  const zoomCenter = useCallback(
    (factor: number) => animateTo(zoomAt(viewRef.current, factor, size.w / 2, size.h / 2, size.w, size.h)),
    [animateTo, size]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Glides the current zoom toward the wheel's target a fraction per frame, so a notch of a
    // mouse wheel (or a burst of trackpad events) reads as one smooth zoom rather than a jump.
    const glide = () => {
      const w = wheel.current
      const v = viewRef.current
      const remaining = Math.log(w.targetK / v.k)
      const next = zoomAt(v, Math.exp(Math.abs(remaining) < 0.003 ? remaining : remaining * 0.3), w.cx, w.cy, size.w, size.h)
      setView(next)
      w.raf = next.k !== v.k && Math.abs(remaining) >= 0.003 ? requestAnimationFrame(glide) : 0
    }
    // Native listener: React's wheel handler is passive, and we need preventDefault.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelAnimationFrame(anim.current)
      const r = canvas.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      const w = wheel.current
      // Sideways trackpad swipes pan instead of zooming.
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setView(panBy(viewRef.current, -e.deltaX, 0, size.w, size.h))
        return
      }
      const dy = wheelPixels(e.deltaY, e.deltaMode, size.h)
      if (e.ctrlKey) {
        // Pinch: small, continuous deltas that should track the fingers directly.
        cancelAnimationFrame(w.raf)
        w.raf = 0
        const v = zoomAt(viewRef.current, Math.exp(-dy * 0.01), cx, cy, size.w, size.h)
        w.targetK = v.k
        setView(v)
        return
      }
      if (!w.raf) w.targetK = viewRef.current.k
      // Accelerated mouse wheels can report huge deltas; cap each event so one flick ≈ one step.
      const step = Math.max(-50, Math.min(50, dy))
      w.targetK = Math.min(MAX_ZOOM, Math.max(1, w.targetK * Math.exp(-step * 0.004)))
      w.cx = cx
      w.cy = cy
      if (!w.raf) w.raf = requestAnimationFrame(glide)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [size, setView])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey) return
      if (e.key === '+' || e.key === '=') zoomCenter(1.5)
      else if (e.key === '-') zoomCenter(1 / 1.5)
      else if (e.key === '0') animateTo(IDENTITY)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomCenter, animateTo])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || viewRef.current.k <= 1) return
    stopMotion()
    drag.current = { x: e.clientX, y: e.clientY, start: viewRef.current, moved: false }
    const move = (ev: MouseEvent) => {
      const d = drag.current!
      const dx = ev.clientX - d.x
      const dy = ev.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      if (!d.moved) {
        d.moved = true
        setDragging(true)
        setHover(undefined)
      }
      setView(panBy(d.start, dx, dy, size.w, size.h))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      // The click that follows a drag must not drill into whatever tile was under the cursor.
      suppressClick.current = Boolean(drag.current?.moved)
      drag.current = undefined
      setDragging(false)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const hoverSymbol = hover?.hit?.kind === 'tile' ? hover.hit.tile.c.symbol : undefined
  const hoverGroup: GroupBox | undefined = hover?.hit?.kind === 'header' ? hover.hit.group : undefined

  useEffect(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !size.w) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
        canvas.width = size.w * dpr
        canvas.height = size.h * dpr
      }
      const ctx = canvas.getContext('2d')!
      const t0 = performance.now()
      draw(ctx, layout, size.w, size.h, {
        quotes: p.quotes,
        refs: p.refs,
        period: p.period,
        hoverSymbol,
        hoverGroup,
        search: p.search,
        legendBucket: p.legendBucket,
        lang,
        view,
        dpr,
        watch: p.watch
      })
      // The first frame after a new layout also measures every label, so it's the one worth timing.
      if (pendingDrawTiming.current !== undefined) {
        window.api.perf('firstDraw', { tiles: pendingDrawTiming.current, ms: Math.round(performance.now() - t0) })
        pendingDrawTiming.current = undefined
      }
    })
  }, [layout, p.version, p.refs, p.period, p.search, p.legendBucket, hoverSymbol, hoverGroup, size, p.quotes, lang, view, p.watch])

  const locate = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const w = toWorld(viewRef.current, x, y)
    return { hit: hitTest(layout, w.x, w.y), x, y }
  }
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current?.moved && !menu) setHover(locate(e))
  }

  // Click drills one level: all → sector → industry. Headers jump straight to their group.
  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const { hit } = locate(e)
    if (!hit || !p.grouped) return
    if (hit.kind === 'header') {
      const g = hit.group
      p.onZoom(g.kind === 'sector' ? { sector: g.name } : { sector: g.sector, industry: g.name })
    } else if (!p.zoom.sector) p.onZoom({ sector: hit.tile.c.sector })
    else if (!p.zoom.industry) p.onZoom({ sector: hit.tile.c.sector, industry: hit.tile.c.industry })
  }

  // Right-click: watchlist actions for a stock, plus "up one level" when drilled in.
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault()
    const { hit, x, y } = locate(e)
    const items: MenuItem[] = []
    if (hit?.kind === 'tile') {
      const sym = hit.tile.c.symbol
      items.push(
        p.watch.has(sym)
          ? { label: t('ctxRemoveWatch', { s: sym }), onSelect: () => p.onWatchRemove(sym) }
          : { label: t('ctxAddWatch', { s: sym }), onSelect: () => p.onWatchAdd(sym) },
        { label: t('ctxCopy'), onSelect: () => void navigator.clipboard.writeText(sym) }
      )
    }
    if (p.zoom.sector)
      items.push({
        label: t('ctxUp'),
        onSelect: () => p.onZoom(p.zoom.industry ? { sector: p.zoom.sector } : {})
      })
    setHover(undefined)
    setMenu(items.length ? { x, y, items } : undefined)
  }

  const peers = useMemo(() => {
    if (hover?.hit?.kind !== 'tile') return []
    const c = hover.hit.tile.c
    return layout.tiles
      .filter((t) => t.c.industry === c.industry && t.c.sector === c.sector)
      .sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))
      .map((t) => t.c)
  }, [hover, layout])

  const clickable = hover?.hit && p.grouped && !p.zoom.industry
  const cursor = dragging ? 'grabbing' : clickable ? 'pointer' : view.k > 1 ? 'grab' : 'default'

  return (
    <div ref={wrapRef} className="heatmap" onMouseLeave={() => setHover(undefined)}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMove}
        onClick={onClick}
        onContextMenu={onContext}
      />
      <div className="zoom-ctrl">
        <button title={t('zoomIn')} onClick={() => zoomCenter(1.5)}>
          +
        </button>
        <button title={t('zoomOut')} onClick={() => zoomCenter(1 / 1.5)} disabled={view.k <= 1}>
          −
        </button>
        {view.k > 1.001 && (
          <button title={t('zoomReset')} onClick={() => animateTo(IDENTITY)}>
            ⟲
          </button>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      {hover?.hit?.kind === 'tile' && !dragging && !menu && (
        <Tooltip
          stock={hover.hit.tile.c}
          peers={peers}
          quotes={p.quotes}
          refs={p.refs}
          period={p.period}
          version={p.version}
          weightKind={p.weightKind}
          x={hover.x}
          y={hover.y}
          bounds={size}
        />
      )}
    </div>
  )
})
