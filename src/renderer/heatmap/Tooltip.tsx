import { useEffect, useState } from 'react'
import type { Candle, Constituent, Period, Quote, RefTable } from '@shared/types'
import { changePct } from '@shared/perf'
import { colorFor, fmtPct } from '../colors'
import { useT } from '../i18n'

const WIDTH = 320
const MAX_PEERS = 12
const cache = new Map<string, { at: number; candles: Candle[] }>()
// Stop showing "loading" after this long; nothing is cached, so the next hover asks again.
const GIVE_UP_MS = 12_000
const HOVER_DELAY_MS = 500

/** Chart data for the hovered stock: candles, `undefined` while loading, or 'unavailable'. */
function useCandles(symbol: string, period: Period): Candle[] | 'unavailable' | undefined {
  const key = `${symbol}:${period}`
  const [candles, setCandles] = useState<Candle[] | 'unavailable' | undefined>(cache.get(key)?.candles)
  useEffect(() => {
    const hit = cache.get(key)
    setCandles(hit?.candles)
    if (hit && Date.now() - hit.at < 60_000) return
    // Answers for a stock you've already moved off must not land in this tooltip.
    let current = true
    // Only after the mouse rests on a stock for half a second, so sweeping across the map
    // doesn't spend API requests on every tile it passes.
    const t = setTimeout(() => {
      window.api
        .candles(symbol, period)
        .then((c) => {
          cache.set(key, { at: Date.now(), candles: c })
          if (current) setCandles(c)
        })
        .catch(() => current && setCandles('unavailable'))
    }, HOVER_DELAY_MS)
    const giveUp = setTimeout(() => current && setCandles((c) => c ?? 'unavailable'), GIVE_UP_MS)
    return () => {
      current = false
      clearTimeout(t)
      clearTimeout(giveUp)
    }
  }, [key, symbol, period])
  return candles
}

function Sparkline({ candles, up, empty }: { candles: Candle[]; up: boolean; empty: string }) {
  if (candles.length < 2) return <div className="spark-empty">{empty}</div>
  const w = WIDTH - 24
  const h = 64
  const ys = candles.map((c) => c.c)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const sx = (i: number) => (i / (candles.length - 1)) * w
  const sy = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4)
  const line = candles.map((c, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(c.c).toFixed(1)}`).join('')
  const color = up ? '#22c25e' : '#f23645'
  return (
    <svg width={w} height={h} className="spark">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill="url(#sparkFill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

interface Props {
  stock: Constituent
  peers: Constituent[]
  quotes: Map<string, Quote>
  refs: RefTable
  period: Period
  version: number
  weightKind: 'etf' | 'holdings'
  x: number
  y: number
  bounds: { w: number; h: number }
}

const fmtPrice = (v?: number) => (v === undefined ? '—' : v.toFixed(2))

export function Tooltip({ stock, peers, quotes, refs, period, x, y, bounds, weightKind }: Props) {
  const tr = useT()
  const candles = useCandles(stock.symbol, period)
  const q = quotes.get(stock.symbol)
  const pct = changePct(q, refs[stock.symbol], period)
  const list = peers.slice(0, MAX_PEERS)

  const estHeight = 150 + list.length * 24
  const left = x + 16 + WIDTH > bounds.w ? Math.max(4, x - 16 - WIDTH) : x + 16
  const top = Math.max(4, Math.min(y + 16, bounds.h - estHeight - 4))

  return (
    <div className="tooltip" style={{ left, top, width: WIDTH }}>
      <div className="tt-industry">
        {tr.sector(stock.sector)} <span>›</span> {tr.industry(stock.industry)}
      </div>
      <div className="tt-head">
        <div>
          <div className="tt-sym">{stock.symbol}</div>
          <div className="tt-name">{stock.name}</div>
          {stock.weight !== undefined && <div className="tt-weight">{tr.t(weightKind === 'holdings' ? 'positionShare' : 'weightLabel', { w: stock.weight.toFixed(2) })}</div>}
        </div>
        <div className="tt-price">
          <div>{fmtPrice(q?.last)}</div>
          <div style={{ color: (pct ?? 0) >= 0 ? '#22c25e' : '#f23645' }}>{fmtPct(pct)}</div>
        </div>
      </div>
      {candles === 'unavailable' ? (
        <div className="spark-empty">{tr.t('chartUnavailable')}</div>
      ) : candles ? (
        <Sparkline candles={candles} up={(pct ?? 0) >= 0} empty={tr.t('noChart')} />
      ) : (
        <div className="spark-empty">{tr.t('loading')}</div>
      )}
      <div className="tt-list">
        {list.map((c) => {
          const cq = quotes.get(c.symbol)
          const cp = changePct(cq, refs[c.symbol], period)
          return (
            <div key={c.symbol} className={`tt-row${c.symbol === stock.symbol ? ' active' : ''}`}>
              <span className="tt-row-sym">
                {c.symbol}
                {c.weight !== undefined && <em>{c.weight.toFixed(1)}%</em>}
              </span>
              <span className="tt-row-price">{fmtPrice(cq?.last)}</span>
              <span className="tt-row-pct" style={{ background: colorFor(cp, period) }}>
                {fmtPct(cp)}
              </span>
            </div>
          )
        })}
        {peers.length > MAX_PEERS && <div className="tt-more">{tr.t('more', { n: peers.length - MAX_PEERS })}</div>}
      </div>
    </div>
  )
}
