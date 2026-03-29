import { Liveline } from 'liveline'
import type { LivelinePoint } from 'liveline'

import { TOKENS } from '../../design/marketTokens'

type MiniTrendChartProps = {
  points: number[]
  tone: 'positive' | 'negative' | 'neutral'
}

const toneColor = {
  positive: TOKENS.colors.success,
  negative: TOKENS.colors.critical,
  neutral: TOKENS.colors.neutral2,
} as const

const CHART_WIDTH = 108
const CHART_HEIGHT = 36

function toPoints(points: number[]): LivelinePoint[] {
  const start = Math.floor(Date.now() / 1000) - points.length * 300

  return points.map((value, index) => ({
    time: start + index * 300,
    value,
  }))
}

export function MiniTrendChart({ points, tone }: MiniTrendChartProps) {
  if (points.length === 0) {
    return null
  }

  const data = toPoints(points)
  const latestValue = data.at(-1)?.value ?? 0
  const chartWindow =
    data.length > 1 ? data.at(-1)!.time - data[0]!.time + 300 : 300

  return (
    <div style={{ width: `${CHART_WIDTH}px`, height: `${CHART_HEIGHT}px` }}>
      <Liveline
        data={data}
        value={latestValue}
        window={chartWindow}
        theme="dark"
        color={toneColor[tone]}
        grid={false}
        badge={false}
        badgeTail={false}
        fill={false}
        pulse={false}
        scrub={false}
        momentum={false}
        showValue={false}
        emptyText=""
        lineWidth={2}
        padding={{ top: 4, right: 4, bottom: 4, left: 4 }}
        className={`mini-trend-chart tone-${tone}`}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  )
}
