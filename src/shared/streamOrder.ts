/**
 * Order for streamer subscriptions. Schwab streams only the first ~3000 symbols of a large list,
 * so the page's benchmark goes first and the rest by market cap: what falls past the cap (and is
 * polled instead) is the smallest companies.
 */
export function subscriptionOrder(symbols: string[], benchmark: string | undefined, capOf: (s: string) => number | undefined): string[] {
  const rest = symbols.filter((s) => s !== benchmark).sort((a, b) => (capOf(b) ?? 0) - (capOf(a) ?? 0))
  return benchmark ? [benchmark, ...rest] : rest
}

/**
 * Wraps an async job so a call made while the previous one is still running is skipped rather
 * than queued: periodic polls then never pile up behind a busy rate limiter.
 */
export function singleFlight<A extends unknown[]>(job: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let running = false
  return async (...args: A) => {
    if (running) return
    running = true
    try {
      await job(...args)
    } finally {
      running = false
    }
  }
}
