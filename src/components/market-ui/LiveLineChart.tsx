import { useEffect, useMemo, useState } from 'react'
import { Liveline } from 'liveline'
import type { LivelinePoint } from 'liveline'
import type { CSSProperties } from 'react'

import { TOKENS } from '../../design/marketTokens'
import { formatAxisNumber } from '../../utils/formatters'

type LiveLineChartProps = {
  points?: number[]
  data?: LivelinePoint[]
  tone?: 'positive' | 'negative' | 'neutral'
  height?: number
  color?: string
  window?: number
  loading?: boolean
  paused?: boolean
}

const toneColor = {
  positive: TOKENS.colors.success,
  negative: TOKENS.colors.critical,
  neutral: TOKENS.colors.neutral2,
} as const

function createTimeFormatter(windowSeconds: number) {
  const hourMinute = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const hourOnly = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: true,
  })
  const dayTime = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    hour12: true,
  })
  const dayOnly = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  })

  const tightenHourLabel = (value: string) => value.replace(/\s/g, '').replace(':00', '')
  const tightenHourMinuteLabel = (value: string) => value.replace(/\s/g, '')

  return (time: number) => {
    const date = new Date(time * 1000)

    if (windowSeconds <= 2 * 60 * 60) {
      return tightenHourMinuteLabel(hourMinute.format(date))
    }

    if (windowSeconds <= 12 * 60 * 60) {
      return tightenHourMinuteLabel(hourMinute.format(date))
    }

    if (windowSeconds <= 24 * 60 * 60) {
      return tightenHourLabel(hourOnly.format(date))
    }

    if (windowSeconds <= 7 * 24 * 60 * 60) {
      return dayTime.format(date).replace(/(\d{1,2})(?::00)?\s?(AM|PM)/, '$1$2')
    }

    return dayOnly.format(date)
  }
}

function toPoints(points: number[], windowSeconds?: number): LivelinePoint[] {
  const span = windowSeconds && windowSeconds > 0
    ? windowSeconds
    : Math.max(points.length - 1, 1) * 300
  const step = points.length > 1 ? span / (points.length - 1) : span
  const start = Math.floor(Date.now() / 1000) - span

  return points.map((value, index) => ({
    time: Math.round(start + index * step),
    value,
  }))
}

export function LiveLineChart({
  points = [],
  data,
  tone = 'positive',
  height = 240,
  color,
  window,
  loading = false,
  paused = false,
}: LiveLineChartProps) {
  const [documentHidden, setDocumentHidden] = useState(() =>
    typeof document === 'undefined' ? false : document.visibilityState === 'hidden',
  )
  const chartData = data ?? toPoints(points, window)
  const latestValue = chartData.at(-1)?.value ?? 0
  const chartWindow =
    window ?? (chartData.length > 1 ? chartData.at(-1)!.time - chartData[0]!.time + 300 : 300)
  const valueSpan = useMemo(() => {
    if (chartData.length === 0) {
      return undefined
    }

    const values = chartData.map((point) => point.value)
    return Math.max(...values) - Math.min(...values)
  }, [chartData])
  const formatValue = useMemo(
    () => (value: number) => formatAxisNumber(value, valueSpan),
    [valueSpan],
  )
  const formatTime = createTimeFormatter(chartWindow)
  const chartSurfaceStyle: CSSProperties & Record<'--chart-surface-inset', string> = {
    width: '100%',
    height,
    '--chart-surface-inset': '10px 62px 30px 10px',
  }

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined
    }

    const handleVisibilityChange = () => {
      setDocumentHidden(document.visibilityState === 'hidden')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return (
    <div className="chart-dotted-surface chart-dotted-surface--line" style={chartSurfaceStyle}>
      <Liveline
        data={chartData}
        value={latestValue}
        window={chartWindow}
        theme="dark"
        color={color ?? toneColor[tone]}
        loading={loading}
        paused={paused || documentHidden}
        formatValue={formatValue}
        formatTime={formatTime}
        className={`live-line-chart tone-${tone}`}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  )
}
