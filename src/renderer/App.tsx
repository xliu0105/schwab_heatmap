import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { etfTicker, etfUniverse, isEtfUniverse, type CloudState, type Constituent, type Period, type Prefs, type Quote, type RefTable, type SizeBy, type Snapshot, type StatusInfo, type UniverseId } from '@shared/types'
import { DEFAULT_PREFS } from '@shared/settingsMerge'
import { Legend } from './components/Legend'
import { Settings } from './components/Settings'
import { Toolbar } from './components/Toolbar'
import { WatchlistAdd } from './components/WatchlistAdd'
import { EtfManager } from './components/EtfManager'
import { Summary } from './components/Summary'
import { Heatmap, type HeatmapHandle } from './heatmap/Heatmap'
import type { Zoom } from './heatmap/layout'
import { LangContext, translator, type Lang } from './i18n'

const RELAYOUT_MS = 5 * 60 * 1000

const LEGACY_KEYS = ['universe', 'period', 'sizeBy', 'grouped', 'lang'] as const

// Before cloud sync, prefs lived in this window's localStorage. Read them once (for a flicker-free
// first paint and a one-time hand-over to the main process), then the main process owns them.
function legacyPrefs(): Partial<Prefs> | undefined {
  try {
    const found: Record<string, unknown> = {}
    for (const k of LEGACY_KEYS) {
      const raw = localStorage.getItem(k)
      if (raw !== null) found[k] = JSON.parse(raw)
    }
    return Object.keys(found).length ? (found as Partial<Prefs>) : undefined
  } catch {
    return undefined
  }
}

/**
 * View prefs and the watchlist, stored (and cloud-synced) by the main process; `ready` once the
 * stored copy is in.
 */
function useSyncedPrefs(): [Prefs, boolean, (patch: Partial<Prefs>) => void, string[], string[]] {
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...legacyPrefs() }))
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [etfs, setEtfs] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void window.api.getSettings().then(async (s) => {
      const legacy = legacyPrefs()
      if (legacy) {
        s = await window.api.updateSettings({ prefs: legacy })
        try {
          LEGACY_KEYS.forEach((k) => localStorage.removeItem(k))
        } catch {
          /* ignore */
        }
      }
      setPrefs(s.prefs)
      setWatchlist(s.watchlist)
      setEtfs(s.etfs)
      setReady(true)
    })
    return window.api.onSettings((s) => {
      setPrefs(s.prefs)
      setWatchlist(s.watchlist)
      setEtfs(s.etfs)
    })
  }, [])
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => ({ ...p, ...patch }))
    void window.api.updateSettings({ prefs: patch })
  }, [])
  return [prefs, ready, update, watchlist, etfs]
}

export function App() {
  const [prefs, prefsReady, setPref, watchlist, etfs] = useSyncedPrefs()
  const [etfNames, setEtfNames] = useState<Record<string, string>>({})
  const [showEtfs, setShowEtfs] = useState(false)
  const watchSet = useMemo(() => new Set(watchlist), [watchlist])
  const addToWatchlist = useCallback(
    (symbols: string[]) => void window.api.updateSettings({ watchlist: [...watchlist, ...symbols] }),
    [watchlist]
  )
  const removeFromWatchlist = useCallback(
    (symbol: string) => void window.api.updateSettings({ watchlist: watchlist.filter((s) => s !== symbol) }),
    [watchlist]
  )
  const { universe, period, grouped, lang } = prefs
  const inEtf = isEtfUniverse(universe)
  // ETF and holdings maps carry per-stock weights (fund weight, position value) and share one
  // sizing pref that defaults to those weights, kept apart from the index maps' sizing.
  const weighted = inEtf || universe === 'holdings'
  // ETF maps keep their own sizing (fund weight by default), separate from the index maps.
  const sizeBy: SizeBy = weighted ? prefs.etfSizeBy : prefs.sizeBy === 'weight' ? 'marketCap' : prefs.sizeBy
  const setUniverse = (u: UniverseId) => setPref({ universe: u })
  const setPeriod = (p: Period) => setPref({ period: p })
  const setSizeBy = (v: SizeBy) => setPref(weighted ? { etfSizeBy: v } : { sizeBy: v })
  const setGrouped = (g: boolean) => setPref({ grouped: g })
  const setLang = (l: Lang) => setPref({ lang: l })
  const [cloud, setCloud] = useState<CloudState>({ status: 'unconfigured' })
  const tr = translator(lang)
  const [constituents, setConstituents] = useState<Constituent[]>([])
  const quotes = useRef(new Map<string, Quote>())
  const [refs, setRefs] = useState<RefTable>({})
  const [benchmark, setBenchmark] = useState<string>()
  const [version, setVersion] = useState(0)
  const [layoutEpoch, setLayoutEpoch] = useState(0)
  const [zoom, setZoom] = useState<Zoom>({})
  const [search, setSearch] = useState('')
  const [legendBucket, setLegendBucket] = useState<number>()
  const [status, setStatus] = useState<StatusInfo>({ auth: { status: 'loggedOut' }, stream: 'off' })
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(false)
  const heatmap = useRef<HeatmapHandle>(null)
  const universeRef = useRef(universe)
  universeRef.current = universe

  const apply = useCallback((s: Snapshot) => {
    if (s.universe !== universeRef.current) return
    quotes.current = new Map(Object.entries(s.quotes))
    setConstituents(s.constituents)
    setRefs(s.refs)
    setBenchmark(s.benchmark)
    setLayoutEpoch((e) => e + 1)
    setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    void window.api.getStatus().then((s) => {
      setStatus(s)
      if (s.auth.status === 'needsConfig') setShowSettings(true)
    })
    void window.api.cloudState().then(setCloud)
    const offs = [
      window.api.onStatus(setStatus),
      window.api.onCloudState(setCloud),
      window.api.onSnapshot(apply),
      window.api.onTicks((qs) => {
        for (const q of qs) quotes.current.set(q.symbol, q)
        setVersion((v) => v + 1)
      }),
      window.api.onRefs((r) => setRefs((prev) => ({ ...prev, ...r }))),
      // Size-only position changes: patch the current constituents in place and redraw, without
      // handing the heatmap a new array (that would re-lay out the tiles).
      window.api.onHoldings((updates) => {
        const bySymbol = new Map(updates.map((u) => [u.symbol, u]))
        setConstituents((cs) => {
          for (const c of cs) Object.assign(c, bySymbol.get(c.symbol))
          return cs
        })
        setVersion((v) => v + 1)
      })
    ]
    const relayout = setInterval(() => setLayoutEpoch((e) => e + 1), RELAYOUT_MS)
    return () => {
      offs.forEach((off) => off())
      clearInterval(relayout)
    }
  }, [apply])

  useEffect(() => {
    // Wait for the stored prefs, or a launch would load the default universe and then switch.
    if (!prefsReady) return
    setZoom({})
    setLoading(true)
    void window.api
      .setUniverse(universe)
      .then(apply)
      .finally(() => setLoading(false))
  }, [universe, apply, prefsReady])

  // Fund names come from the fetched holdings, so refresh them after an ETF map loads.
  useEffect(() => {
    void window.api.etfNames(etfs).then(setEtfNames)
  }, [etfs, constituents])

  // Removing the ETF on screen (here or on another machine) falls back to the S&P 500. Only an
  // actual removal counts: a just-added ETF is selected before the saved list catches up.
  const prevEtfs = useRef<string[]>()
  useEffect(() => {
    if (!prefsReady) return
    const prev = prevEtfs.current
    prevEtfs.current = etfs
    if (!inEtf) return
    const tk = etfTicker(universe)
    const removed = prev ? prev.includes(tk) && !etfs.includes(tk) : !etfs.includes(tk)
    if (removed) setPref({ universe: 'sp500' })
  }, [prefsReady, inEtf, etfs, universe, setPref])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement).tagName === 'INPUT') return
      setZoom((z) => (z.industry ? { sector: z.sector } : {}))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const refreshUniverses = async () => {
    setLoading(true)
    try {
      apply(await window.api.refreshUniverses())
    } catch (e) {
      alert(tr.t('refreshFailed', { err: (e as Error).message }))
    } finally {
      setLoading(false)
    }
  }

  const screenshot = () => {
    const url = heatmap.current?.toDataUrl()
    if (url) void window.api.savePng(url)
  }

  const etfName = inEtf ? etfNames[etfTicker(universe)] : undefined
  const universeLabel = etfName ? `${tr.universe(universe)} · ${etfName}` : tr.universe(universe)
  const names = useMemo(() => Object.fromEntries(constituents.map((c) => [c.symbol, c.name])), [constituents])
  const watchAdd = (inline: boolean) => (
    <WatchlistAdd watchlist={watchlist} names={names} onAdd={addToWatchlist} onRemove={removeFromWatchlist} inline={inline} />
  )
  const loggedIn = status.auth.status === 'loggedIn'
  const empty = !loading && constituents.length === 0

  return (
    <LangContext.Provider value={lang}>
    <div className="app">
      <div className="titlebar-drag" />
      <Toolbar
        universe={universe}
        period={period}
        sizeBy={sizeBy}
        grouped={grouped}
        search={search}
        status={status}
        onUniverse={setUniverse}
        onPeriod={setPeriod}
        onSizeBy={setSizeBy}
        onGrouped={(g) => {
          setGrouped(g)
          setZoom({})
        }}
        onSearch={setSearch}
        onRefreshUniverses={refreshUniverses}
        onScreenshot={screenshot}
        onFullscreen={() => void window.api.toggleFullscreen()}
        onSettings={() => setShowSettings(true)}
        onToggleLang={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        etfs={etfs}
        etfNames={etfNames}
        onManageEtfs={() => setShowEtfs(true)}
        cloud={cloud}
        extra={universe === 'watchlist' && watchlist.length > 0 ? watchAdd(false) : undefined}
      />
      <div className="crumbs">
        <button className={!zoom.sector ? 'current' : ''} onClick={() => setZoom({})}>
          {universeLabel}
        </button>
        {zoom.sector && (
          <>
            <span>›</span>
            <button className={!zoom.industry ? 'current' : ''} onClick={() => setZoom({ sector: zoom.sector })}>
              {tr.sector(zoom.sector)}
            </button>
          </>
        )}
        {zoom.industry && (
          <>
            <span>›</span>
            <button className="current">{tr.industry(zoom.industry)}</button>
          </>
        )}
        <Summary
          universe={universe}
          constituents={constituents}
          quotes={quotes.current}
          refs={refs}
          period={period}
          version={version}
          benchmark={benchmark}
          zoom={zoom}
        />
      </div>
      <div className="map-wrap">
        <Heatmap
          ref={heatmap}
          constituents={constituents}
          quotes={quotes.current}
          refs={refs}
          version={version}
          layoutEpoch={layoutEpoch}
          period={period}
          sizeBy={sizeBy}
          grouped={grouped}
          zoom={zoom}
          search={search}
          legendBucket={legendBucket}
          onZoom={setZoom}
          watch={watchSet}
          weightKind={universe === 'holdings' ? 'holdings' : 'etf'}
          onWatchAdd={(sym) => addToWatchlist([sym])}
          onWatchRemove={removeFromWatchlist}
        />
        {!loggedIn && !showSettings && (
          <div className="overlay">
            <div>
              <p>{tr.t('needLogin')}</p>
              <button className="primary" onClick={() => setShowSettings(true)}>
                {status.auth.status === 'needsConfig' ? tr.t('enterSettings') : tr.t('login')}
              </button>
            </div>
          </div>
        )}
        {universe === 'watchlist' && watchlist.length === 0 && !showSettings ? (
          <div className="overlay">
            <div className="wl-empty-screen">
              <p>{tr.t('emptyWatchlist')}</p>
              {watchAdd(true)}
            </div>
          </div>
        ) : (
          loggedIn &&
          empty && (
            <div className="overlay">
              <p>{tr.t('emptyUniverse')}</p>
            </div>
          )
        )}
        {loading && <div className="loading-bar" />}
      </div>
      <div className="footer">
        <span className="footer-note">{tr.t('footer', { n: constituents.length })}</span>
        <Legend period={period} onHover={setLegendBucket} />
      </div>
      {showSettings && <Settings status={status} cloud={cloud} onClose={() => setShowSettings(false)} />}
      {showEtfs && (
        <EtfManager
          etfs={etfs}
          names={etfNames}
          onChange={(next) => void window.api.updateSettings({ etfs: next })}
          onOpen={(tk) => setUniverse(etfUniverse(tk))}
          onClose={() => setShowEtfs(false)}
        />
      )}
    </div>
    </LangContext.Provider>
  )
}
