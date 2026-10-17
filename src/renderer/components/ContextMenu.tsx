import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect(): void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose(): void
}

/** Small menu at the cursor; anything outside it (click, wheel, Esc, leaving the window) closes it. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Flip toward the cursor when the menu would run off the map's right or bottom edge.
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return
    const left = x + el.offsetWidth > parent.clientWidth ? Math.max(4, x - el.offsetWidth) : x
    const top = y + el.offsetHeight > parent.clientHeight ? Math.max(4, y - el.offsetHeight) : y
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // Capture phase so Esc closes only the menu instead of also leaving the drilled-in level.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('wheel', onClose, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', outside, true)
      window.removeEventListener('wheel', onClose, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div ref={ref} className="ctx-menu" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <div
          key={it.label}
          role="menuitem"
          className="ctx-item"
          onClick={() => {
            onClose()
            it.onSelect()
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  )
}
