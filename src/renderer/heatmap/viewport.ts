// Map-style zoom over the laid-out heatmap: screen = layout × k + (tx, ty).

export interface View {
  k: number
  tx: number
  ty: number
}

export const IDENTITY: View = { k: 1, tx: 0, ty: 0 }
export const MAX_ZOOM = 10

/** Keeps the zoom in range and the content covering the whole viewport (no empty margins). */
export function clampView(v: View, w: number, h: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(1, v.k))
  if (k === 1) return IDENTITY
  const clamp = (t: number, size: number) => Math.min(0, Math.max(size - size * k, t))
  return { k, tx: clamp(v.tx, w), ty: clamp(v.ty, h) }
}

/** Zooms by `factor` keeping the layout point under screen (cx, cy) fixed. */
export function zoomAt(v: View, factor: number, cx: number, cy: number, w: number, h: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(1, v.k * factor))
  const s = k / v.k
  return clampView({ k, tx: cx - (cx - v.tx) * s, ty: cy - (cy - v.ty) * s }, w, h)
}

export function panBy(v: View, dx: number, dy: number, w: number, h: number): View {
  return clampView({ k: v.k, tx: v.tx + dx, ty: v.ty + dy }, w, h)
}

export function toWorld(v: View, x: number, y: number): { x: number; y: number } {
  return { x: (x - v.tx) / v.k, y: (y - v.ty) / v.k }
}

/**
 * Perceptually even transition from a to b: the zoom moves geometrically (each frame scales by the
 * same ratio) and the layout point at the viewport centre slides linearly, so a zoom about the
 * centre keeps that point still. `u` is clamped, so a stray early or late frame can't overshoot.
 */
export function interpolate(a: View, b: View, u: number, w: number, h: number): View {
  const t = Math.min(1, Math.max(0, u))
  const k = a.k * (b.k / a.k) ** t
  const pa = toWorld(a, w / 2, h / 2)
  const pb = toWorld(b, w / 2, h / 2)
  const px = pa.x + (pb.x - pa.x) * t
  const py = pa.y + (pb.y - pa.y) * t
  return { k, tx: w / 2 - px * k, ty: h / 2 - py * k }
}

/** Normalises a wheel event's vertical delta to pixels, whatever unit the device reports in. */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * pageHeight : deltaY
}
