import { useCallback, useEffect, useState } from 'react'

import { fetchPlatformLivePoint } from '../api/roblox'
import type { LiveValuePoint } from '../types'

const LIVE_PLATFORM_POINT_STORAGE_KEY = 'roterminal:live-platform-point'

let livePlatformPointCache: LiveValuePoint | null = null

function readStoredPoint() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(LIVE_PLATFORM_POINT_STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as LiveValuePoint
    livePlatformPointCache = parsed
    return parsed
  } catch {
    return null
  }
}

function writeStoredPoint(point: LiveValuePoint) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(LIVE_PLATFORM_POINT_STORAGE_KEY, JSON.stringify(point))
  } catch {
    // Ignore storage failures; memory cache still helps.
  }
}

type UsePlatformLivePointState = {
  data: LiveValuePoint | null
  isLoading: boolean
}

export function usePlatformLivePoint(pollIntervalMs = 15_000): UsePlatformLivePointState {
  const [data, setData] = useState<LiveValuePoint | null>(
    () => livePlatformPointCache ?? readStoredPoint(),
  )
  const [isLoading, setIsLoading] = useState(
    () => livePlatformPointCache == null && readStoredPoint() == null,
  )

  const refresh = useCallback(async () => {
    try {
      const next = await fetchPlatformLivePoint()
      livePlatformPointCache = next
      writeStoredPoint(next)
      setData(next)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const cachedPoint = livePlatformPointCache ?? readStoredPoint()

    if (cachedPoint) {
      setData(cachedPoint)
      setIsLoading(false)
    }

    void refresh()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, pollIntervalMs)

    return () => window.clearInterval(intervalId)
  }, [pollIntervalMs, refresh])

  return {
    data,
    isLoading,
  }
}
