import type { Period } from '@shared/types'
import { STEPS, legendLabels } from '../colors'

export function Legend({ period, onHover }: { period: Period; onHover(b?: number): void }) {
  const labels = legendLabels(period)
  return (
    <div className="legend" onMouseLeave={() => onHover(undefined)}>
      {STEPS.map(([, color], i) => (
        <div key={i} className="legend-step" style={{ background: color }} onMouseEnter={() => onHover(i)}>
          {labels[i]}
        </div>
      ))}
    </div>
  )
}
