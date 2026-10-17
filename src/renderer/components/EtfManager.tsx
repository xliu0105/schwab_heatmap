import { useEffect, useRef, useState } from 'react'
import { normalizeSymbol } from '@shared/symbols'
import { useT } from '../i18n'

interface Props {
  etfs: string[]
  names: Record<string, string>
  onChange(etfs: string[]): void
  /** Switches the map to an ETF just added. */
  onOpen(ticker: string): void
  onClose(): void
}

type Status = { kind: 'loading' | 'ok' | 'error'; text: string } | undefined

/**
 * Adds, removes and reorders the ETFs in the universe menu. A ticker is checked (its holdings
 * fetched) before it joins the list, so the menu never offers an ETF that can't be drawn.
 */
export function EtfManager({ etfs, names, onChange, onOpen, onClose }: Props) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  const add = async () => {
    const ticker = normalizeSymbol(query)
    if (!ticker || status?.kind === 'loading') return
    if (etfs.includes(ticker)) {
      onOpen(ticker)
      setQuery('')
      return
    }
    setStatus({ kind: 'loading', text: t('etfLoading', { s: ticker }) })
    const r = await window.api.lookupEtf(ticker)
    if (!r.ok) {
      setStatus({ kind: 'error', text: r.reason === 'notFound' ? t('etfNotFound', { s: ticker }) : t('etfFailed', { s: ticker, err: r.detail ?? '' }) })
      return
    }
    onChange([...etfs, r.ticker])
    onOpen(r.ticker)
    setStatus({ kind: 'ok', text: t('etfAdded', { s: r.ticker, n: r.count }) })
    setQuery('')
  }

  const move = (i: number, d: -1 | 1) => {
    const next = [...etfs]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal etf-manager" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{t('etfManagerTitle')}</h2>
        <input
          ref={input}
          className="wl-input"
          value={query}
          placeholder={t('etfPlaceholder')}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        {status && <div className={`etf-status ${status.kind}`}>{status.text}</div>}
        <div className="wl-rows">
          {etfs.map((tk, i) => (
            <div key={tk} className="wl-row etf-row">
              <span className="wl-sym">{tk}</span>
              <span className="wl-name">{names[tk] ?? ''}</span>
              <button className="wl-remove" title={t('moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="wl-remove" title={t('moveDown')} disabled={i === etfs.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="wl-remove" title={t('removeWatch')} onClick={() => onChange(etfs.filter((x) => x !== tk))}>
                ×
              </button>
            </div>
          ))}
          {!etfs.length && <div className="wl-empty">{t('etfEmpty')}</div>}
        </div>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
