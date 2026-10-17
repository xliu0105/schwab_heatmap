import { app } from 'electron'
import { appendFile } from 'fs/promises'
import { join } from 'path'

/**
 * Timing breadcrumbs (one JSON object per line in userData/perf.log) for diagnosing slow
 * universe switches. Only durations and counts are written, never quotes or account data.
 */
export function perfLog(event: string, data: Record<string, number | string | boolean>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...data }) + '\n'
  void appendFile(join(app.getPath('userData'), 'perf.log'), line).catch(() => {})
}

/** Stopwatch for named phases: `lap('quotes')` records the time since the previous lap. */
export function stopwatch(): { lap(name: string): void; laps: Record<string, number> } {
  let last = performance.now()
  const laps: Record<string, number> = {}
  return {
    laps,
    lap(name) {
      const now = performance.now()
      laps[name] = Math.round(now - last)
      last = now
    }
  }
}
