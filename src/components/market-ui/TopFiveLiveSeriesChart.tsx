import { useEffect, useMemo, useRef, useState } from 'react'
import { Liveline } from 'liveline'
import type { LivelinePoint, LivelineSeries } from 'liveline'

import { fetchGameLivePoint } from '../../api/roblox'
import { TOKENS } from '../../design/marketTokens'
import type { LiveLeaderboardRow, TrendPoint } from '../../types'
import { formatAxisNumber } from '../../utils/formatters'

type TopFiveLiveSeriesChartProps = {
  games: LiveLeaderboardRow[]
  timelineByUniverseId?: Record<number, TrendPoint[]>
  windowSeconds: number
  mode?: 'live' | 'history'
  height?: number
  loading?: boolean
  hiddenUniverseIds?: number[]
}

const SERIES_COLORS = [
  TOKENS.colors.accent1,
  'rgb(216, 151, 31)',
  'rgb(28, 226, 183)',
  '#FF7A59',
  '#B793FF',
] as const
const CHART_PADDING = {
  top: 10,
  right: 64,
  bottom: 30,
  left: 14,
} as const
const MAX_GAME_LABEL_LENGTH = 10
const MAX_SERIES_COUNT = 3
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

function truncateGameLabel(label: string) {
  if (label.length <= MAX_GAME_LABEL_LENGTH) {
    return label
  }

  return `${label.slice(0, MAX_GAME_LABEL_LENGTH)}…`
}

function createTimeFormatter(windowSeconds: number) {
  const minuteSecond = new Intl.DateTimeFormat('en-US', {
    minute: '2-digit',
    second: '2-digit',
  })
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

  return (time: number) => {
    const date = new Date(time * 1000)

    if (windowSeconds <= 5 * 60) {
      return minuteSecond.format(date)
    }

    if (windowSeconds <= 12 * 60 * 60) {
      return hourMinute.format(date).replace(/\s/g, '')
    }

    if (windowSeconds <= 24 * 60 * 60) {
      return hourOnly.format(date).replace(/\s/g, '').replace(':00', '')
    }

    if (windowSeconds <= 7 * 24 * 60 * 60) {
      return dayTime.format(date).replace(/(\d{1,2})(?::00)?\s?(AM|PM)/, '$1$2')
    }

    return dayOnly.format(date)
  }
}

function currentUnixSeconds() {
  return Date.now() / 1000
}

function dedupePoints(points: LivelinePoint[]) {
  const byTime = new Map<number, LivelinePoint>()

  for (const point of points) {
    byTime.set(point.time, point)
  }

  return [...byTime.values()].sort((left, right) => left.time - right.time)
}

function trimPoints(points: LivelinePoint[], windowSeconds: number, nowSeconds: number) {
  const cutoff = nowSeconds - windowSeconds
  const trimmed = points.filter((point) => point.time >= cutoff)

  if (trimmed.length > 0) {
    return trimmed
  }

  return points.length > 0 ? [points.at(-1)!] : []
}

function ensureRenderableSeries(
  points: LivelinePoint[],
  windowSeconds: number,
  nowSeconds: number,
) {
  if (points.length === 0 || points.length > 1) {
    return points
  }

  const onlyPoint = points[0]
  const fallbackGap = Math.min(Math.max(windowSeconds / 6, 1), 10)
  const anchorTime = Math.min(onlyPoint.time - 1, nowSeconds - 1)
  const clampedAnchorTime = Math.max(
    nowSeconds - windowSeconds,
    anchorTime,
    onlyPoint.time - fallbackGap,
  )

  return dedupePoints([
    { time: clampedAnchorTime, value: onlyPoint.value },
    onlyPoint,
  ])
}

function smoothHistoricalPoints(points: LivelinePoint[], windowSeconds: number) {
  const targetPoints =
    windowSeconds >= THIRTY_DAYS_SECONDS
      ? 56
      : windowSeconds >= ONE_WEEK_SECONDS
        ? 42
        : null

  if (targetPoints == null || points.length <= targetPoints) {
    return points
  }

  const firstPoint = points[0]
  const lastPoint = points.at(-1)
  const interior = points.slice(1, -1)
  const bucketCount = Math.max(1, targetPoints - 2)
  const averagedPoints: LivelinePoint[] = [firstPoint]

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const startIndex = Math.floor((bucketIndex / bucketCount) * interior.length)
    const endIndex = Math.floor(((bucketIndex + 1) / bucketCount) * interior.length)
    const bucket = interior.slice(startIndex, endIndex)

    if (bucket.length === 0) {
      continue
    }

    const averageTime =
      bucket.reduce((sum, point) => sum + point.time, 0) / bucket.length
    const averageValue =
      bucket.reduce((sum, point) => sum + point.value, 0) / bucket.length

    averagedPoints.push({
      time: Math.round(averageTime),
      value: averageValue,
    })
  }

  if (lastPoint) {
    averagedPoints.push(lastPoint)
  }

  return dedupePoints(averagedPoints)
}

function seedPoints(values: number[], windowSeconds: number): LivelinePoint[] {
  if (values.length === 0) {
    return []
  }

  const span = windowSeconds > 0 ? windowSeconds : Math.max(values.length - 1, 1) * 300
  const step = values.length > 1 ? span / (values.length - 1) : span
  const start = Math.floor(Date.now() / 1000) - span

  return values.map((value, index) => ({
    time: Math.round(start + index * step),
    value,
  }))
}

function seedPointsFromTimeline(points: TrendPoint[]) {
  const resolved = points
    .filter((point) => Number.isFinite(point.value))
    .map((point, index) => {
      const parsedTime = point.timestamp ? Date.parse(point.timestamp) : Number.NaN
      return {
        time:
          Number.isNaN(parsedTime)
            ? Math.floor(Date.now() / 1000) - (points.length - index) * 300
            : Math.floor(parsedTime / 1000),
        value: point.value,
      }
    })

  return dedupePoints(resolved)
}

function seedSeriesMap(games: LiveLeaderboardRow[], windowSeconds: number) {
  const nowSeconds = currentUnixSeconds()

  return Object.fromEntries(
    games.map((game) => {
      const seeded = seedPoints(game.sparkline, windowSeconds)
      const latestValue = seeded.at(-1)?.value ?? game.playing
      const nextPoints = dedupePoints([
        ...seeded,
        { time: nowSeconds, value: latestValue },
      ])

      return [String(game.universeId), trimPoints(nextPoints, windowSeconds, nowSeconds)]
    }),
  ) as Record<string, LivelinePoint[]>
}

function buildSeriesPoints({
  game,
  timeline,
  windowSeconds,
  mode,
}: {
  game: LiveLeaderboardRow
  timeline: TrendPoint[]
  windowSeconds: number
  mode: 'live' | 'history'
}) {
  const nowSeconds = currentUnixSeconds()

  if (timeline.length > 0) {
    const seededTimeline = seedPointsFromTimeline(timeline)

    if (mode === 'history') {
      return ensureRenderableSeries(smoothHistoricalPoints(
        trimPoints(seededTimeline, windowSeconds, nowSeconds),
        windowSeconds,
      ), windowSeconds, nowSeconds)
    }

    return ensureRenderableSeries(trimPoints(
      dedupePoints([
        ...seededTimeline,
        { time: nowSeconds, value: timeline.at(-1)?.value ?? game.playing },
      ]),
      windowSeconds,
      nowSeconds,
    ), windowSeconds, nowSeconds)
  }

  return seedSeriesMap([game], windowSeconds)[String(game.universeId)] ?? []
}

function hasUsableSeries(points: LivelinePoint[] | undefined) {
  return Array.isArray(points) && points.length > 0
}

function areSameGameSet(left: LiveLeaderboardRow[], right: LiveLeaderboardRow[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((game, index) => game.universeId === right[index]?.universeId)
}

export function TopFiveLiveSeriesChart({
  games,
  timelineByUniverseId = {},
  windowSeconds,
  mode = 'live',
  height = 320,
  loading = false,
  hiddenUniverseIds = [],
}: TopFiveLiveSeriesChartProps) {
  const topGames = useMemo(
    () => games.slice().sort((left, right) => right.playing - left.playing).slice(0, MAX_SERIES_COUNT),
    [games],
  )
  const [displayGames, setDisplayGames] = useState(topGames)
  const topGameKey = topGames.map((game) => game.universeId).join(':')
  const [seriesMap, setSeriesMap] = useState<Record<string, LivelinePoint[]>>(() =>
    seedSeriesMap(topGames, windowSeconds),
  )
  const topGamesRef = useRef(displayGames)

  useEffect(() => {
    if (topGames.length === 0) {
      return
    }

    setDisplayGames((current) => {
      if (areSameGameSet(current, topGames)) {
        return current
      }

      return topGames
    })
  }, [topGameKey, topGames])

  useEffect(() => {
    if (displayGames.length === 0) {
      return
    }

    topGamesRef.current = displayGames
  }, [displayGames])

  useEffect(() => {
    if (displayGames.length === 0) {
      return
    }

    if (mode === 'live') {
      setSeriesMap((current) => {
        const nextMap: Record<string, LivelinePoint[]> = {}
        let changed = false

        for (const game of displayGames) {
          const id = String(game.universeId)

          if (hasUsableSeries(current[id])) {
            nextMap[id] = current[id]
            continue
          }

          const timeline = timelineByUniverseId[game.universeId] ?? []
          const rangedSeed = buildSeriesPoints({
            game,
            timeline,
            windowSeconds,
            mode,
          })
          nextMap[id] = hasUsableSeries(rangedSeed)
            ? rangedSeed
            : seedSeriesMap([game], windowSeconds)[id] ?? []
          changed = true
        }

        if (
          Object.keys(current).some((id) => !(id in nextMap))
        ) {
          changed = true
        }

        return changed ? nextMap : current
      })

      return
    }

    setSeriesMap((current) => {
      const nextEntries = displayGames.map((game) => {
        const id = String(game.universeId)
        const timeline = timelineByUniverseId[game.universeId] ?? []
        const rangedSeed = buildSeriesPoints({
          game,
          timeline,
          windowSeconds,
          mode,
        })

        if (hasUsableSeries(rangedSeed)) {
          return [id, rangedSeed] as const
        }

        if (loading && hasUsableSeries(current[id])) {
          return [id, current[id]] as const
        }

        return [id, seedSeriesMap([game], windowSeconds)[id] ?? current[id] ?? []] as const
      })

      const nextMap = Object.fromEntries(nextEntries)
      const hasAnySeries = Object.values(nextMap).some((points) => points.length > 0)

      return hasAnySeries ? nextMap : current
    })
  }, [displayGames, loading, mode, timelineByUniverseId, windowSeconds])

  useEffect(() => {
    if (mode !== 'live' || displayGames.length === 0) {
      return
    }

    const intervalId = window.setInterval(() => {
      setSeriesMap((current) => {
        const nowSeconds = currentUnixSeconds()
        const nextEntries = Object.entries(current).map(([id, points]) => {
          if (points.length === 0) {
            return [id, points] as const
          }

          const historical = points.length > 1 ? points.slice(0, -1) : []
          const livePoint = points.at(-1)!

          return [
            id,
            dedupePoints(
              trimPoints(
                [...historical, { time: nowSeconds, value: livePoint.value }],
                windowSeconds,
                nowSeconds,
              ),
            ),
          ] as const
        })

        return Object.fromEntries(nextEntries)
      })
    }, 100)

    return () => window.clearInterval(intervalId)
  }, [displayGames.length, mode, topGameKey, windowSeconds])

  useEffect(() => {
    if (mode !== 'live' || displayGames.length === 0) {
      return
    }

    let cancelled = false
    let inFlight = false

    const refresh = async () => {
      if (inFlight) {
        return
      }

      inFlight = true

      try {
        const activeGames = topGamesRef.current
        const latestPoints = await Promise.all(
          activeGames.map(async (game) => ({
            universeId: game.universeId,
            sample: await fetchGameLivePoint(game.universeId),
          })),
        )

        if (cancelled) {
          return
        }

        setSeriesMap((current) => {
          const nowSeconds = currentUnixSeconds()
          const nextState: Record<string, LivelinePoint[]> = {}

          for (const game of topGamesRef.current) {
            const id = String(game.universeId)
            const currentPoints = current[id] ?? seedPoints(game.sparkline, windowSeconds)
            const latest = latestPoints.find((entry) => entry.universeId === game.universeId)?.sample

            if (!latest) {
              nextState[id] = currentPoints
              continue
            }

            const sampleSeconds = latest.timestamp ? Date.parse(latest.timestamp) / 1000 : nowSeconds
            const historical = currentPoints.length > 1 ? currentPoints.slice(0, -1) : currentPoints
            const committed = trimPoints(
              [...historical, { time: sampleSeconds, value: latest.value }],
              windowSeconds,
              sampleSeconds,
            )

            nextState[id] = dedupePoints([
              ...committed,
              { time: Math.max(sampleSeconds, nowSeconds), value: latest.value },
            ])
          }

          return nextState
        })
      } catch {
        // Ignore transient polling failures; the series stay warm with the last known values.
      } finally {
        inFlight = false
      }
    }

    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, 5_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [displayGames.length, mode, topGameKey, windowSeconds])

  const series = useMemo<LivelineSeries[]>(
    () =>
      displayGames.map((game, index) => {
        const id = String(game.universeId)
        const data = seriesMap[id] ?? seedPoints(game.sparkline, windowSeconds)
        const value = data.at(-1)?.value ?? game.playing

        return {
          id,
          data,
          value,
          color: SERIES_COLORS[index % SERIES_COLORS.length],
          label: truncateGameLabel(game.name),
        }
      }).filter((entry) => !hiddenUniverseIds.includes(Number(entry.id))),
    [displayGames, hiddenUniverseIds, seriesMap, windowSeconds],
  )
  const visibleSeriesValueSpan = useMemo(() => {
    const values = series.flatMap((entry) => entry.data.map((point) => point.value))

    if (values.length === 0) {
      return undefined
    }

    const minValue = Math.min(...values)
    const maxValue = Math.max(...values)
    return maxValue - minValue
  }, [series])
  const formatValue = useMemo(
    () => (value: number) => formatAxisNumber(value, visibleSeriesValueSpan),
    [visibleSeriesValueSpan],
  )

  const chartSurfaceStyle = {
    width: '100%',
    height,
    position: 'relative' as const,
    ['--chart-surface-inset' as const]: `${CHART_PADDING.top}px ${CHART_PADDING.right}px ${CHART_PADDING.bottom}px ${CHART_PADDING.left}px`,
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      <div className="chart-dotted-surface chart-dotted-surface--line top-three-live-chart" style={chartSurfaceStyle}>
        <Liveline
          data={[]}
          value={0}
          series={series}
          window={windowSeconds}
          theme="dark"
          loading={loading}
          paused={false}
          scrub
          pulse={mode === 'live'}
          exaggerate
          lineWidth={2.25}
          formatValue={formatValue}
          formatTime={createTimeFormatter(windowSeconds)}
          className="live-line-chart tone-neutral"
          style={{ width: '100%', height: '100%', display: 'block' }}
          padding={CHART_PADDING}
          seriesToggleCompact
        />
      </div>
    </div>
  )
}
