import { useEffect, useRef, useState } from 'react'

export interface Option<V> {
  id: V
  label: string
}

export interface OptionGroup<V> {
  label?: string
  options: Option<V>[]
}

interface Props<V> {
  label: string
  value: V
  groups: OptionGroup<V>[]
  onChange(v: V): void
  /** An action row under the options (e.g. "Manage ETFs…"); it runs instead of selecting. */
  footer?: { label: string; onClick(): void }
}

/**
 * Menu that always opens below its button. The native macOS popup instead centers the selected
 * item over the button, which pushes earlier options off-screen for a toolbar at the top.
 */
export function Dropdown<V extends string>({ label, value, groups, onChange, footer }: Props<V>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<V>(value)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const flat = groups.flatMap((g) => g.options)
  const current = flat.find((o) => o.id === value)

  useEffect(() => {
    if (!open) return
    setActive(value)
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', close)
    }
  }, [open, value])

  // Keep the highlighted item in view, starting with the selected one when the menu opens.
  useEffect(() => {
    if (open) panel.current?.querySelector('.dd-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const choose = (v: V) => {
    setOpen(false)
    if (v !== value) onChange(v)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    const i = flat.findIndex((o) => o.id === active)
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') setActive(flat[Math.min(flat.length - 1, i + 1)].id)
    else if (e.key === 'ArrowUp') setActive(flat[Math.max(0, i - 1)].id)
    else if (e.key === 'Enter') choose(active)
    else return
    e.preventDefault()
    // Esc closes the menu only; the app's own Esc handler (zoom out) shouldn't also fire.
    e.stopPropagation()
  }

  return (
    <div className="tb-select" ref={root}>
      {label && <span>{label}</span>}
      <div className="dd">
        <button className={`dd-button${open ? ' open' : ''}`} onClick={() => setOpen(!open)} onKeyDown={onKeyDown}>
          <span className="dd-value">{current?.label ?? value}</span>
          <span className="dd-caret">▾</span>
        </button>
        {open && (
          <div className="dd-panel" ref={panel} role="listbox">
            {groups.map((g, gi) => (
              <div key={gi} className="dd-group">
                {g.label && <div className="dd-group-label">{g.label}</div>}
                {g.options.map((o) => (
                  <div
                    key={o.id}
                    role="option"
                    aria-selected={o.id === value}
                    className={`dd-item${o.id === active ? ' active' : ''}${o.id === value ? ' selected' : ''}`}
                    onMouseEnter={() => setActive(o.id)}
                    onClick={() => choose(o.id)}
                  >
                    <span className="dd-check">{o.id === value ? '✓' : ''}</span>
                    {o.label}
                  </div>
                ))}
              </div>
            ))}
            {footer && (
              <div
                className="dd-item dd-action"
                onClick={() => {
                  setOpen(false)
                  footer.onClick()
                }}
              >
                <span className="dd-check" />
                {footer.label}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
