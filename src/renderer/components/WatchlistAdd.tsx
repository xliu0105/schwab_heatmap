import { useEffect, useRef, useState } from 'react'
import { parseSymbolList, type SymbolEntry } from '@shared/symbolSearch'
import { useT } from '../i18n'

interface Props {
  watchlist: string[]
  names: Record<string, string>
  onAdd(symbols: string[]): void
  onRemove(symbol: string): void
  /** Embedded in the empty-watchlist screen: always open, no toggle button. */
  inline?: boolean
}

type Row =
  | { kind: 'many'; symbols: string[] }
  | { kind: 'match'; entry: SymbolEntry }
  | { kind: 'unknown'; symbol: string }
  | { kind: 'current'; symbol: string }

/**
 * Type-ahead for adding to the watchlist: search all US stocks by ticker or name, Enter to add,
 * paste several tickers to add them at once. With an empty query it lists the watchlist itself,
 * each with a remove button, so this is the one place to manage it.
 */
export function WatchlistAdd({ watchlist, names, onAdd, onRemove, inline }: Props) {
  const { t } = useT()
  const [open, setOpen] = useState(Boolean(inline))
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SymbolEntry[]>([])
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const inList = new Set(watchlist)

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open || inline) return
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', outside)
    return () => window.removeEventListener('mousedown', outside)
  }, [open, inline])

  useEffect(() => {
    const q = query.trim()
    if (!q || parseSymbolList(q).length > 1) {
      setMatches([])
      return
    }
    const timer = setTimeout(() => void window.api.searchSymbols(q).then(setMatches), 80)
    return () => clearTimeout(timer)
  }, [query])

  const tokens = parseSymbolList(query)
  const rows: Row[] = []
  if (!query.trim()) rows.push(...watchlist.map((symbol): Row => ({ kind: 'current', symbol })))
  else if (tokens.length > 1) {
    const fresh = tokens.filter((s) => !inList.has(s))
    if (fresh.length) rows.push({ kind: 'many', symbols: fresh })
  } else {
    rows.push(...matches.map((entry): Row => ({ kind: 'match', entry })))
    // Allow tickers the local table doesn't know (ETFs, fresh listings), but not while the input is
    // just the start of a known ticker ("NVD" while NVDA is listed).
    const sym = tokens[0]
    if (sym && !inList.has(sym) && !matches.some((m) => m.symbol.startsWith(sym))) rows.push({ kind: 'unknown', symbol: sym })
  }

  useEffect(() => setActive(0), [query, matches])

  const act = (row: Row) => {
    if (row.kind === 'many') onAdd(row.symbols)
    else if (row.kind === 'unknown') onAdd([row.symbol])
    else if (row.kind === 'match') (inList.has(row.entry.symbol) ? onRemove : (s: string) => onAdd([s]))(row.entry.symbol)
    else return
    // Stay open with an empty box, ready for the next one.
    setQuery('')
    input.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((i) => Math.min(rows.length - 1, i + 1))
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
    else if (e.key === 'Enter' && rows[active]) act(rows[active])
    else if (e.key === 'Escape') {
      if (query) setQuery('')
      else if (!inline) setOpen(false)
    } else return
    e.preventDefault()
  }

  const panel = (
    <div className={`wl-panel${inline ? ' inline' : ''}`}>
      <input
        ref={input}
        className="wl-input"
        value={query}
        placeholder={t('addPlaceholder')}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="wl-rows">
        {rows.map((row, i) => {
          const cls = `wl-row${i === active ? ' active' : ''}`
          const hover = () => setActive(i)
          switch (row.kind) {
            case 'many':
              return (
                <div key="many" className={cls} onMouseEnter={hover} onClick={() => act(row)}>
                  <span className="wl-plus">+</span>
                  {t('addMany', { n: row.symbols.length, list: row.symbols.join(' ') })}
                </div>
              )
            case 'unknown':
              return (
                <div key="unknown" className={cls} onMouseEnter={hover} onClick={() => act(row)}>
                  <span className="wl-plus">+</span>
                  {t('addUnknown', { s: row.symbol })}
                </div>
              )
            case 'match': {
              const has = inList.has(row.entry.symbol)
              return (
                <div key={row.entry.symbol} className={cls} onMouseEnter={hover} onClick={() => act(row)}>
                  <span className={`wl-mark${has ? ' on' : ''}`}>{has ? '✓' : '+'}</span>
                  <span className="wl-sym">{row.entry.symbol}</span>
                  <span className="wl-name">{row.entry.name}</span>
                </div>
              )
            }
            case 'current':
              return (
                <div key={row.symbol} className={cls} onMouseEnter={hover}>
                  <span className="wl-mark on">★</span>
                  <span className="wl-sym">{row.symbol}</span>
                  <span className="wl-name">{names[row.symbol] ?? ''}</span>
                  <button className="wl-remove" title={t('removeWatch')} onClick={() => onRemove(row.symbol)}>
                    ×
                  </button>
                </div>
              )
          }
        })}
        {!rows.length && (
          <div className="wl-empty">{query.trim() ? t('noMatches') : t('watchEmpty')}</div>
        )}
      </div>
    </div>
  )

  if (inline) return panel
  return (
    <div className="wl" ref={root}>
      <button className={`dd-button wl-button${open ? ' open' : ''}`} onClick={() => setOpen(!open)}>
        {t('addStock')}
      </button>
      {open && panel}
    </div>
  )
}
