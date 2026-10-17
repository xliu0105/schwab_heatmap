/**
 * Which kind of work a request is, in priority order:
 * - interactive: something you're waiting on (hover chart, first load of a map, positions)
 * - refresh: keeping what's on screen current (re-polls, share counts)
 * - bulk: background sync (daily history), paced evenly
 */
export type Lane = 'interactive' | 'refresh' | 'bulk'
const LANES: Lane[] = ['interactive', 'refresh', 'bulk']

export interface Reserves {
  /** Slots per window that refresh work leaves free for interactive work. */
  refresh: number
  /** Slots per window that bulk work leaves free for the other two. */
  bulk: number
}

export interface LimiterStats {
  queued: Record<Lane, number>
  /** Starts within the current window. */
  used: number
  active: number
}

/**
 * Sliding-window limiter with three priority lanes. Interactive and refresh work may burst;
 * bulk work is paced at least `windowMs / limit` apart so the budget isn't spent in a burst
 * followed by a long stall. Lower lanes leave reserved slots of every window to higher ones, and
 * a lane only starts when every higher lane is empty.
 */
export class RateLimiter {
  private starts: number[] = []
  private lastBulk = -Infinity
  private active = 0
  private queues: Record<Lane, (() => void)[]> = { interactive: [], refresh: [], bulk: [] }
  private timer?: ReturnType<typeof setTimeout>
  private readonly interval: number

  constructor(
    private limit: number,
    private windowMs: number,
    private concurrency = 6,
    private now: () => number = Date.now,
    private reserves: Reserves = { refresh: 0, bulk: 0 }
  ) {
    this.interval = windowMs / limit
  }

  async run<T>(task: () => Promise<T>, opts: { lane?: Lane } = {}): Promise<T> {
    await new Promise<void>((resolve) => {
      this.queues[opts.lane ?? 'interactive'].push(resolve)
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
    return LANES.reduce((n, l) => n + this.queues[l].length, 0)
  }

  stats(): LimiterStats {
    const now = this.now()
    return {
      queued: { interactive: this.queues.interactive.length, refresh: this.queues.refresh.length, bulk: this.queues.bulk.length },
      used: this.starts.filter((t) => now - t < this.windowMs).length,
      active: this.active
    }
  }

  private cap(lane: Lane): number {
    return lane === 'interactive' ? this.limit : this.limit - this.reserves[lane]
  }

  private start(now: number, lane: Lane): void {
    this.starts.push(now)
    this.active++
    if (lane === 'bulk') this.lastBulk = now
    this.queues[lane].shift()!()
  }

  private pump(): void {
    const now = this.now()
    this.starts = this.starts.filter((t) => now - t < this.windowMs)
    // Until the oldest start in the window expires, no lane gets a slot it doesn't have now.
    const windowFreesIn = this.starts.length ? this.windowMs - (now - this.starts[0]) : 0
    let wait = Infinity

    for (const lane of LANES) {
      const q = this.queues[lane]
      if (!q.length) continue
      if (lane === 'bulk') {
        if (this.active >= this.concurrency) break
        const paceWait = this.lastBulk + this.interval - now
        const roomy = this.starts.length < this.cap('bulk')
        if (paceWait <= 0 && roomy) {
          this.start(now, 'bulk')
          if (q.length) wait = Math.min(wait, this.interval)
        } else wait = Math.min(wait, roomy ? paceWait : windowFreesIn)
        break
      }
      while (q.length && this.active < this.concurrency && this.starts.length < this.cap(lane)) this.start(now, lane)
      if (q.length) {
        // Blocked by the window (concurrency frees itself when a task finishes and pumps again).
        if (this.starts.length >= this.cap(lane)) wait = Math.min(wait, windowFreesIn)
        break
      }
    }

    if (wait !== Infinity && !this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.pump()
      }, Math.max(0, wait) + 1)
  }
}
