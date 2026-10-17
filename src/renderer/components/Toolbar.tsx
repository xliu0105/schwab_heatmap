import type { ReactNode } from 'react'
import { etfUniverse, isEtfUniverse, PERIODS, UNIVERSES, type CloudState, type Period, type SizeBy, type StatusInfo, type UniverseId } from '@shared/types'
import { useT, type T } from '../i18n'
import { Dropdown, type Option } from './Dropdown'

interface Props {
  universe: UniverseId
  period: Period
  sizeBy: SizeBy
  grouped: boolean
  search: string
  status: StatusInfo
  onUniverse(u: UniverseId): void
  onPeriod(p: Period): void
  onSizeBy(s: SizeBy): void
  onGrouped(g: boolean): void
  onSearch(s: string): void
  onRefreshUniverses(): void
  onScreenshot(): void
  onFullscreen(): void
  onSettings(): void
  onToggleLang(): void
  cloud: CloudState
  /** Shown after the search box, e.g. the watchlist add button. */
  extra?: ReactNode
  etfs: string[]
  etfNames: Record<string, string>
  onManageEtfs(): void
}

// Background sync gets 90 of the limiter's 110 requests/min (20 are reserved for foreground).
const HISTORY_PER_SEC = 90 / 60

function etaText(tr: T, remaining: number): string {
  const min = remaining / HISTORY_PER_SEC / 60
  return min < 1 ? tr.t('etaUnder1') : tr.t('etaMin', { n: Math.ceil(min) })
}

function AccountButton({ cloud, onClick }: { cloud: CloudState; onClick(): void }) {
  const tr = useT()
  const signedIn = cloud.status === 'signedIn'
  const dot = !signedIn ? '' : cloud.error ? 'err' : cloud.syncing ? 'busy' : 'ok'
  const title = signedIn
    ? [cloud.email, tr.cloudError(cloud.error) ?? (cloud.lastSync ? tr.t('syncedAt', { time: tr.time(cloud.lastSync) }) : '')].filter(Boolean).join('\n')
    : tr.t('signInGoogle')
  return (
    <button className={`tb-account${signedIn ? ' in' : ''}`} title={title} onClick={onClick}>
      {signedIn ? (cloud.email ?? '?')[0].toUpperCase() : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="5" r="3" />
          <path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5z" />
        </svg>
      )}
      {dot && <i className={dot} />}
    </button>
  )
}

const STREAM_KEY = { off: 'streamOff', connecting: 'streamConnecting', live: 'streamLive', error: 'streamError' } as const

export function Toolbar(p: Props) {
  const tr = useT()
  const { t } = tr
  const hp = p.status.historyProgress
  const historyReady = !hp || hp.done >= hp.total
  const periods = PERIODS.map((o) => ({
    id: o.id,
    label: !historyReady && !['1D', 'EXT'].includes(o.id) ? `${tr.period(o.id)} (${hp!.done}/${hp!.total})` : tr.period(o.id)
  }))
  const sizes: Option<SizeBy>[] = [
    ...(isEtfUniverse(p.universe) ? [{ id: 'weight' as const, label: t('sizeWeight') }] : []),
    ...(p.universe === 'holdings' ? [{ id: 'weight' as const, label: t('sizePosition') }] : []),
    { id: 'marketCap', label: t('sizeMarketCap') },
    { id: 'equal', label: t('sizeEqual') },
    { id: 'volume', label: t('sizeVolume') },
    { id: 'dollarVolume', label: t('sizeDollarVolume') }
  ]
  const group = (g: 'us' | 'mine') => ({
    label: t(g === 'us' ? 'groupUs' : 'groupMine'),
    options: UNIVERSES.filter((u) => u.group === g).map((u): Option<UniverseId> => ({ id: u.id, label: tr.universe(u.id) }))
  })
  const etfGroup = {
    label: t('groupEtf'),
    options: p.etfs.map((tk): Option<UniverseId> => ({ id: etfUniverse(tk), label: p.etfNames[tk] ? `${tk} · ${p.etfNames[tk]}` : tk }))
  }
  const universes = [group('us'), etfGroup, group('mine')]
  const statusTitle = [tr.message(p.status.message), p.status.polled ? t('pollNote', { n: p.status.polled }) : undefined]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="toolbar">
      <div className="tb-left">
        <Dropdown
          label=""
          value={p.universe}
          groups={universes}
          onChange={p.onUniverse}
          footer={{ label: t('manageEtfs'), onClick: p.onManageEtfs }}
        />
        <Dropdown label={t('size')} value={p.sizeBy} groups={[{ options: sizes }]} onChange={p.onSizeBy} />
        <Dropdown label={t('color')} value={p.period} groups={[{ options: periods }]} onChange={p.onPeriod} />
        <button className={`tb-toggle${p.grouped ? ' on' : ''}`} onClick={() => p.onGrouped(!p.grouped)}>
          {t('groupBySector')}
        </button>
        <input className="tb-search" placeholder={t('search')} value={p.search} onChange={(e) => p.onSearch(e.target.value)} />
        {p.extra}
      </div>
      <div className="tb-right">
        {!historyReady && (
          <span className="tb-sync" title={t('syncHint')}>
            {t('syncProgress', { done: hp!.done, total: hp!.total, eta: etaText(tr, hp!.total - hp!.done) })}
          </span>
        )}
        <span className={`tb-status ${p.status.stream}`} title={statusTitle || undefined}>
          <i />
          {t(STREAM_KEY[p.status.stream])}
        </span>
        <button className="tb-icon tb-lang" title={t('switchLang')} onClick={p.onToggleLang}>
          {tr.lang === 'zh' ? 'EN' : '中'}
        </button>
        <button className="tb-icon" title={t('refreshUniverses')} onClick={p.onRefreshUniverses}>⟳</button>
        <button className="tb-icon" title={t('exportPng')} onClick={p.onScreenshot}>⤓</button>
        <button className="tb-icon" title={t('fullscreen')} onClick={p.onFullscreen}>⛶</button>
        <button className="tb-icon" title={t('settings')} onClick={p.onSettings}>⚙</button>
        {p.cloud.status !== 'unconfigured' && <AccountButton cloud={p.cloud} onClick={p.onSettings} />}
      </div>
    </div>
  )
}
