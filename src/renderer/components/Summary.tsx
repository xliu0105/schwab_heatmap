import type { Constituent, Period, Quote, RefTable, UniverseId } from '@shared/types'
import { isEtfUniverse } from '@shared/types'
import { changePct } from '@shared/perf'
import { buyAndHold, type Aggregate } from '@shared/aggregate'
import { holdingsDay, liveValue } from '@shared/positions'
import { fmtPct } from '../colors'
import { useT } from '../i18n'
import type { Zoom } from '../heatmap/layout'

interface Props {
  universe: UniverseId
  constituents: Constituent[]
  quotes: Map<string, Quote>
  refs: RefTable
  period: Period
  /** Re-render on every tick batch. */
  version: number
  benchmark?: string
  zoom: Zoom
  /** Drawn from remembered prices; fresh quotes are on the way. */
  stale?: boolean
}

type Weighting = 'cap' | 'equal' | 'fund' | 'position'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, signDisplay: 'always' })
// To the cent, so the total can be checked against the broker.
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const price = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Short names for the quoted indices; ETFs just show their ticker.
const INDEX_NAMES: Record<string, { zh: string; en: string }> = {
  $SPX: { zh: '标普 500', en: 'S&P 500' },
  $NDX: { zh: '纳指 100', en: 'Nasdaq 100' },
  $COMPX: { zh: '纳斯达克综合', en: 'Nasdaq Composite' },
  $DJI: { zh: '道指', en: 'Dow' },
  $DJT: { zh: '道琼斯运输', en: 'Dow Transports' },
  $DJU: { zh: '道琼斯公用事业', en: 'Dow Utilities' },
  $BKX: { zh: 'KBW 银行', en: 'KBW Bank' }
}

function estimate(cs: Constituent[], quotes: Map<string, Quote>, refs: RefTable, period: Period, w: Weighting): Aggregate | undefined {
  return buyAndHold(
    cs.map((c) => ({
      value: w === 'equal' ? 1 : w === 'fund' ? c.weight : w === 'position' ? liveValue(c, quotes.get(c.symbol)) : quotes.get(c.symbol)?.marketCap,
      pct: changePct(quotes.get(c.symbol), refs[c.symbol], period)
    }))
  )
}

const tone = (p: number) => (p > 0 ? 'up' : p < 0 ? 'down' : '')

/** The page's overall move for the selected period, plus the drilled-in group's when zoomed. */
export function Summary(p: Props) {
  const tr = useT()
  const { t } = tr
  const isHoldings = p.universe === 'holdings'
  const pageWeighting: Weighting = isHoldings ? 'position' : isEtfUniverse(p.universe) ? 'fund' : p.universe === 'watchlist' ? 'equal' : 'cap'

  const parts: React.ReactNode[] = []
  const pctSpan = (a: Aggregate, key: string, label?: string) => (
    <span key={key} className="sum-item">
      {label && <span className="sum-label">{label}</span>}
      <b className={`sum-pct ${tone(a.pct)}`}>{fmtPct(a.pct)}</b>
      {a.covered / a.total < 0.9 && <span className="sum-note">{t('coverage', { c: a.covered, t: a.total })}</span>}
    </span>
  )

  const official = p.benchmark ? changePct(p.quotes.get(p.benchmark), p.refs[p.benchmark], p.period) : undefined
  if (official !== undefined) {
    const last = p.quotes.get(p.benchmark!)?.last
    parts.push(
      <span key="official" className="sum-item">
        <span className="sum-label">{INDEX_NAMES[p.benchmark!]?.[tr.lang] ?? p.benchmark}</span>
        {last !== undefined && <span className="sum-price">{price.format(last)}</span>}
        <b className={`sum-pct ${tone(official)}`}>{fmtPct(official)}</b>
      </span>
    )
  } else if (p.universe === 'watchlist') {
    const eq = estimate(p.constituents, p.quotes, p.refs, p.period, 'equal')
    const cap = estimate(p.constituents, p.quotes, p.refs, p.period, 'cap')
    if (eq) parts.push(pctSpan(eq, 'eq', t('equalWeight')))
    if (cap) parts.push(pctSpan(cap, 'cap', t('capWeight')))
  } else {
    const a = isHoldings && p.period === '1D' ? holdingsDay(p.constituents, p.quotes) ?? estimate(p.constituents, p.quotes, p.refs, p.period, pageWeighting) : estimate(p.constituents, p.quotes, p.refs, p.period, pageWeighting)
    if (isHoldings) {
      const total = p.constituents.reduce((sum, c) => sum + (liveValue(c, p.quotes.get(c.symbol)) ?? 0), 0)
      if (total > 0)
        parts.push(
          <span key="total" className="sum-item">
            <span className="sum-label">{t('totalValue')}</span>
            <span className="sum-price">{dollars.format(total)}</span>
          </span>
        )
    }
    if (a) {
      parts.push(pctSpan(a, 'est'))
      if (isHoldings)
        parts.push(
          <span key="money" className={`sum-money ${tone(a.change)}`}>
            {money.format(a.change)}
          </span>
        )
      // Index and ETF pages normally quote the real thing; say when this is our own estimate.
      else if (p.benchmark || p.universe !== 'allus') parts.push(<span key="est-note" className="sum-note">{t('estimated')}</span>)
    }
  }
  if (isHoldings && p.period !== '1D' && p.period !== 'EXT' && parts.length) parts.push(<span key="replay" className="sum-note">{t('replayHoldings')}</span>)

  // Drilled into a sector or industry: that group's move, weighted like the page.
  let group: React.ReactNode = null
  if (p.zoom.sector) {
    const inGroup = p.constituents.filter((c) => c.sector === p.zoom.sector && (!p.zoom.industry || c.industry === p.zoom.industry))
    const g = estimate(inGroup, p.quotes, p.refs, p.period, pageWeighting)
    if (g)
      group = (
        <span className="sum-item sum-group">
          <span className="sum-label">{p.zoom.industry ? tr.industry(p.zoom.industry) : tr.sector(p.zoom.sector)}</span>
          <b className={`sum-pct ${tone(g.pct)}`}>{fmtPct(g.pct)}</b>
        </span>
      )
  }

  if (!parts.length && !group) return null
  return (
    <div className={`summary${p.stale ? ' stale' : ''}`}>
      {p.stale && <span className="sum-stale">{t('updatingQuotes')}</span>}
      {group}
      {parts}
      <span className="sum-period">{tr.period(p.period)}</span>
    </div>
  )
}
