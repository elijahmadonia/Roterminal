import { useCallback, useEffect, useState } from 'react'

import { fetchLivePlatform } from '../api/roblox'
import type { ChartRange, LivePlatformResponse } from '../types'

const livePlatformCache = new Map<ChartRange, LivePlatformResponse>()
const LIVE_PLATFORM_STORAGE_PREFIX = 'roterminal:live-platform:'

function getPlatformRefreshIntervalMs(range: ChartRange): number {
  switch (range) {
    case '30m':
    case '1h':
    case '24h':
      return 5_000
    case '6h':
      return 10_000
    case '7d':
      return 20_000
    case '30d':
      return 30_000
    default:
      return 15_000
  }
}

function readStoredPlatform(range: ChartRange) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(`${LIVE_PLATFORM_STORAGE_PREFIX}${range}`)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as LivePlatformResponse
    livePlatformCache.set(range, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeStoredPlatform(range: ChartRange, platform: LivePlatformResponse) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(`${LIVE_PLATFORM_STORAGE_PREFIX}${range}`, JSON.stringify(platform))
  } catch {
    // Ignore storage failures; in-memory cache still helps.
  }
}

type LivePlatformState = {
  data: LivePlatformResponse | null
  error: string | null
  isLoading: boolean
  refresh: () => Promise<void>
}

export function useLivePlatform(range: ChartRange = '24h'): LivePlatformState {
  const refreshIntervalMs = getPlatformRefreshIntervalMs(range)
  const [data, setData] = useState<LivePlatformResponse | null>(
    () => livePlatformCache.get(range) ?? readStoredPlatform(range),
  )
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(
    () => !livePlatformCache.has(range) && !readStoredPlatform(range),
  )

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const platform = await fetchLivePlatform(range)
      livePlatformCache.set(range, platform)
      writeStoredPlatform(range, platform)
      setData(platform)
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Unknown backend failure'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [range])

  useEffect(() => {
    const cachedPlatform = livePlatformCache.get(range) ?? readStoredPlatform(range)

    if (cachedPlatform) {
      setData(cachedPlatform)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }

    void refresh()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, refreshIntervalMs)

    return () => window.clearInterval(intervalId)
  }, [range, refresh, refreshIntervalMs])

  return {
    data,
    error,
    isLoading,
    refresh,
  }
}
