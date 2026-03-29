import { useEffect, useMemo, useRef, useState } from 'react'
import type { LivelinePoint } from 'liveline'

type LiveSample = {
  timestamp: string
  value: number
}

type UseRollingLivelineOptions = {
  initialData: LivelinePoint[]
  windowSeconds: number
  reseedKey?: string | number
  enabled?: boolean
  pollIntervalMs?: number
  heartbeatMs?: number
  fetchLatest?: () => Promise<LiveSample>
}

function currentUnixSeconds() {
  return Date.now() / 1000
}

function toUnixSeconds(timestamp: string | undefined, fallback: number) {
  if (!timestamp) {
    return fallback
  }

  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? fallback : parsed / 1000
}

function trimPoints(points: LivelinePoint[], windowSeconds: number, nowSeconds: number) {
  const cutoff = nowSeconds - windowSeconds
  const trimmed = points.filter((point) => point.time >= cutoff)

  if (trimmed.length > 0) {
    return trimmed
  }

  return points.length > 0 ? [points.at(-1)!] : []
}

function dedupePoints(points: LivelinePoint[]) {
  const byTime = new Map<number, LivelinePoint>()

  for (const point of points) {
    byTime.set(point.time, point)
  }

  return [...byTime.values()].sort((left, right) => left.time - right.time)
}

function ensureRenderableSeries(
  points: LivelinePoint[],
  windowSeconds: number,
  nowSeconds: number,
) {
  if (points.length === 0) {
    return points
  }

  if (points.length > 1) {
    return points
  }

  const onlyPoint = points[0]
  const fallbackGap = Math.min(Math.max(windowSeconds / 6, 1), 10)
  const anchorTime = Math.min(onlyPoint.time - 1, nowSeconds - 1)
  const clampedAnchorTime = Math.max(nowSeconds - windowSeconds, anchorTime, onlyPoint.time - fallbackGap)

  return dedupePoints([
    { time: clampedAnchorTime, value: onlyPoint.value },
    onlyPoint,
  ])
}

function seedSeries(initialData: LivelinePoint[], windowSeconds: number) {
  const nowSeconds = currentUnixSeconds()
  const base = dedupePoints(initialData).sort((left, right) => left.time - right.time)

  if (base.length === 0) {
    return []
  }

  const trimmed = trimPoints(base, windowSeconds, nowSeconds)
  const latestValue = trimmed.at(-1)?.value ?? base.at(-1)?.value ?? 0

  return ensureRenderableSeries(dedupePoints([
    ...trimmed,
    { time: nowSeconds, value: latestValue },
  ]), windowSeconds, nowSeconds)
}

export function useRollingLiveline({
  initialData,
  windowSeconds,
  reseedKey,
  enabled = true,
  pollIntervalMs = 2_000,
  heartbeatMs = 250,
  fetchLatest,
}: UseRollingLivelineOptions) {
  const seeded = useMemo(
    () => seedSeries(initialData, windowSeconds),
    [initialData, windowSeconds],
  )
  const [series, setSeries] = useState<LivelinePoint[]>(seeded)
  const fetchLatestRef = useRef(fetchLatest)
  const previousWindowSecondsRef = useRef(windowSeconds)
  const previousReseedKeyRef = useRef(reseedKey)

  useEffect(() => {
    fetchLatestRef.current = fetchLatest
  }, [fetchLatest])

  useEffect(() => {
    setSeries((current) => {
      const windowChanged = previousWindowSecondsRef.current !== windowSeconds
      const reseedKeyChanged = previousReseedKeyRef.current !== reseedKey
      previousWindowSecondsRef.current = windowSeconds
      previousReseedKeyRef.current = reseedKey

      if (seeded.length > 0 && (current.length === 0 || windowChanged || reseedKeyChanged)) {
        return seeded
      }

      return current
    })
  }, [reseedKey, seeded, windowSeconds])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const intervalId = window.setInterval(() => {
      setSeries((current) => {
        if (current.length === 0) {
          return current
        }

        const nowSeconds = currentUnixSeconds()
        const historical = current.length > 1 ? current.slice(0, -1) : []
        const livePoint = current.at(-1)!

        return ensureRenderableSeries(dedupePoints(
          trimPoints(
            [...historical, { time: nowSeconds, value: livePoint.value }],
            windowSeconds,
            nowSeconds,
          ),
        ), windowSeconds, nowSeconds)
      })
    }, heartbeatMs)

    return () => window.clearInterval(intervalId)
  }, [enabled, heartbeatMs, windowSeconds])

  useEffect(() => {
    if (!enabled || !fetchLatestRef.current) {
      return
    }

    let cancelled = false
    let inFlight = false

    const refresh = async () => {
      if (inFlight) {
        return
      }

      const runFetchLatest = fetchLatestRef.current

      if (!runFetchLatest) {
        return
      }

      inFlight = true

      try {
        const next = await runFetchLatest()

        if (cancelled) {
          return
        }

        setSeries((current) => {
          const nowSeconds = currentUnixSeconds()
          const sampleSeconds = toUnixSeconds(next.timestamp, nowSeconds)
          const historical = current.length > 1 ? current.slice(0, -1) : current
          const committed = trimPoints(
            [...historical, { time: sampleSeconds, value: next.value }],
            windowSeconds,
            sampleSeconds,
          )

          return ensureRenderableSeries(dedupePoints([
            ...committed,
            { time: Math.max(sampleSeconds, nowSeconds), value: next.value },
          ]), windowSeconds, nowSeconds)
        })
      } catch {
        // Ignore transient live polling failures; the trailing point keeps moving.
      } finally {
        inFlight = false
      }
    }

    void refresh()
    const intervalId = window.setInterval(() => {
      void refresh()
    }, pollIntervalMs)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [enabled, pollIntervalMs, windowSeconds])

  return {
    data: series,
    latestValue: series.at(-1)?.value ?? null,
  }
}
