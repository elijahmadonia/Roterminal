import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchGameDetail } from '../api/roblox'
import type { ChartRange, GameDetailResponse } from '../types'

const gameDetailCache = new Map<string, GameDetailResponse>()

interface GameDetailState {
  data: GameDetailResponse | null
  error: string | null
  isLoading: boolean
  refresh: () => Promise<void>
}

function getGameDetailCacheKey(universeId: number, range: ChartRange) {
  return `${universeId}:${range}`
}

export function useGameDetail(
  universeId: number | null,
  range: ChartRange,
): GameDetailState {
  const [data, setData] = useState<GameDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const requestIdRef = useRef(0)
  const latestDataRef = useRef<GameDetailResponse | null>(null)

  useEffect(() => {
    latestDataRef.current = data
  }, [data])

  const refresh = useCallback(async () => {
    if (universeId == null) {
      setData(null)
      setError(null)
      setIsLoading(false)
      return
    }

    const cacheKey = getGameDetailCacheKey(universeId, range)
    const requestId = ++requestIdRef.current

    try {
      setError(null)
      const detail = await fetchGameDetail(universeId, range, 'full')
      if (requestIdRef.current !== requestId) {
        return
      }

      gameDetailCache.set(cacheKey, detail)
      setData(detail)
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return
      }

      const message =
        requestError instanceof Error ? requestError.message : 'Unknown backend failure'

      if (!gameDetailCache.has(cacheKey)) {
        setError(message)
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
      }
    }
  }, [range, universeId])

  useEffect(() => {
    if (universeId == null) {
      setData(null)
      setError(null)
      setIsLoading(false)
      return
    }

    const cacheKey = getGameDetailCacheKey(universeId, range)
    const cached = gameDetailCache.get(cacheKey) ?? null
    const requestId = ++requestIdRef.current
    const previousUniverseData =
      latestDataRef.current?.game.universeId === universeId
        ? latestDataRef.current
        : null

    setError(null)

    if (cached) {
      setData(cached)
      setIsLoading(false)
    } else {
      if (!previousUniverseData) {
        setData(null)
      }
      setIsLoading(previousUniverseData == null)
    }

    let cancelled = false

    const load = async () => {
      if (!cached) {
        try {
          const coreDetail = await fetchGameDetail(universeId, range, 'core')

          if (cancelled || requestIdRef.current !== requestId) {
            return
          }

          gameDetailCache.set(cacheKey, coreDetail)
          setData(coreDetail)
          setIsLoading(false)
        } catch (requestError) {
          if (cancelled || requestIdRef.current !== requestId) {
            return
          }

          const message =
            requestError instanceof Error ? requestError.message : 'Unknown backend failure'
          setError(message)
          setIsLoading(false)
          return
        }
      }

      try {
        const fullDetail = await fetchGameDetail(universeId, range, 'full')

        if (cancelled || requestIdRef.current !== requestId) {
          return
        }

        gameDetailCache.set(cacheKey, fullDetail)
        setData(fullDetail)
        setError(null)
      } catch (requestError) {
        if (cancelled || requestIdRef.current !== requestId) {
          return
        }

        const message =
          requestError instanceof Error ? requestError.message : 'Unknown backend failure'

        if (!gameDetailCache.has(cacheKey)) {
          setError(message)
        }
      } finally {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoading(false)
        }
      }
    }

    void load()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [range, refresh, universeId])

  return {
    data,
    error,
    isLoading,
    refresh,
  }
}
