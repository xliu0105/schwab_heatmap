// US market clock helpers. Holidays are ignored: at worst a holiday triggers one extra refresh.

const DAY = 86_400_000
const ET = 'America/New_York'

function etParts(t: number): { y: number; m: number; d: number; wd: string; offsetMs: number } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short'
  })
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return { y: +p.year, m: +p.month, d: +p.day, wd: p.weekday, offsetMs: asUtc - Math.floor(t / 60_000) * 60_000 }
}

/** Timestamp of the most recent 16:00 New York close on a weekday, at or before `now`. */
export function lastMarketClose(now: number): number {
  for (let back = 0; back < 8; back++) {
    const p = etParts(now - back * DAY)
    if (p.wd === 'Sat' || p.wd === 'Sun') continue
    const close = Date.UTC(p.y, p.m - 1, p.d, 16) - p.offsetMs
    if (close <= now) return close
  }
  return now - 7 * DAY
}

/** New York calendar date (YYYY-MM-DD) of a timestamp. */
export function sessionDate(t: number): string {
  const p = etParts(t)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/** The weekday close before the given one. */
export function previousClose(close: number): number {
  return lastMarketClose(close - 1)
}

/** 9:30 New York time of the session after the one that closed at `close`. */
export function nextOpenAfter(close: number): number {
  for (let k = 1; k <= 5; k++) {
    const c = lastMarketClose(close + k * DAY)
    if (c > close) return c - 6.5 * 3_600_000
  }
  return close + DAY
}
