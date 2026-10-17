/**
 * Sliding-window limiter with two lanes. Foreground work (quotes, charts the user is looking at)
 * may burst up to the window limit. Background work (bulk history sync) is paced at least
 * `windowMs / limit` apart, so the budget isn't spent in a burst followed by a long stall, and
 * leaves `reserve` slots of every window free for foreground requests.
 */
export class RateLimiter {
  private starts: number[] = []
  private lastBackground = -Infinity
  private active = 0
  private fg: (() => void)[] = []
  private bg: (() => void)[] = []
  private timer?: ReturnType<typeof setTimeout>
  private readonly interval: number

  constructor(
    private limit: number,
    private windowMs: number,
    private concurrency = 6,
    private now: () => number = Date.now,
    private reserve = 0
  ) {
    this.interval = windowMs / limit
  }

  async run<T>(task: () => Promise<T>, opts: { background?: boolean } = {}): Promise<T> {
    await new Promise<void>((resolve) => {
      ;(opts.background ? this.bg : this.fg).push(resolve)
      this.pump()
    })
    try {
      return await task()
    } finally {
      this.active--
      this.pump()
    }
  }

  get pending(): number {
    return this.fg.length + this.bg.length
  }

  private start(now: number, resolve: () => void): void {
    this.starts.push(now)
    this.active++
    resolve()
  }

  private pump(): void {
    const now = this.now()
    this.starts = this.starts.filter((t) => now - t < this.windowMs)
    // Until the oldest start in the window expires, no lane can use a slot it doesn't have.
    const windowFreesIn = this.starts.length ? this.windowMs - (now - this.starts[0]) : 0

    while (this.fg.length && this.active < this.concurrency && this.starts.length < this.limit)
      this.start(now, this.fg.shift()!)

    let wait = Infinity
    if (this.fg.length && this.starts.length >= this.limit) wait = windowFreesIn
    if (this.bg.length && !this.fg.length && this.active < this.concurrency) {
      const paceWait = this.lastBackground + this.interval - now
      const roomy = this.starts.length < this.limit - this.reserve
      if (paceWait <= 0 && roomy) {
        this.lastBackground = now
        this.start(now, this.bg.shift()!)
        if (this.bg.length) wait = Math.min(wait, this.interval)
      } else wait = Math.min(wait, roomy ? paceWait : windowFreesIn)
    }

    if (wait !== Infinity && !this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.pump()
      }, Math.max(0, wait) + 1)
  }
}
