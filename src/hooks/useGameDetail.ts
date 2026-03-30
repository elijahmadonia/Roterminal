import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchGameDetail } from '../api/roblox'
import type { ChartRange, GameDetailResponse } from '../types'

const gameDetailCache = new Map<string, GameDetailResponse>()
const DEFERRED_SUPPLEMENTAL_SOURCE = 'Deferred supplemental fetch'
const DEFERRED_RETRY_DELAY_MS = 1_800

interface GameDetailState {
  data: GameDetailResponse | null
  error: string | null
  isLoading: boolean
  isRefreshing: boolean
  refresh: () => Promise<void>
}

function getGameDetailCacheKey(universeId: number, range: ChartRange) {
  return `${universeId}:${range}`
}

function hasDeferredSupplemental(detail: GameDetailResponse | null) {
  if (!detail?.dataSections) {
    return false
  }

  return [
    detail.dataSections.pageMeta?.source,
    detail.dataSections.creatorProfile?.source,
    detail.dataSections.creatorPortfolio?.source,
    detail.dataSections.servers?.source,
    detail.dataSections.store?.gamePasses?.source,
    detail.dataSections.store?.developerProducts?.source,
  ].some((value) => value === DEFERRED_SUPPLEMENTAL_SOURCE)
}

export function useGameDetail(
  universeId: number | null,
  range: ChartRange,
): GameDetailState {
  const [data, setData] = useState<GameDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const requestIdRef = useRef(0)
  const dataRef = useRef<GameDetailResponse | null>(null)
  const deferredRetryKeysRef = useRef(new Set<string>())
  const deferredRetryTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const clearDeferredRetry = useCallback(() => {
    if (deferredRetryTimeoutRef.current != null) {
      window.clearTimeout(deferredRetryTimeoutRef.current)
      deferredRetryTimeoutRef.current = null
    }
  }, [])

  const refresh = useCallback(async () => {
    if (universeId == null) {
      clearDeferredRetry()
      setData(null)
      setError(null)
      setIsLoading(false)
      setIsRefreshing(false)
      return
    }

    const cacheKey = getGameDetailCacheKey(universeId, range)
    const requestId = ++requestIdRef.current
    const hasVisibleSameGame = dataRef.current?.game.universeId === universeId

    try {
      clearDeferredRetry()
      setError(null)
      setIsRefreshing(hasVisibleSameGame)
      setIsLoading(!hasVisibleSameGame)

      const detail = await fetchGameDetail(universeId, range, 'full')

      if (requestIdRef.current !== requestId) {
        return
      }

      gameDetailCache.set(cacheKey, detail)
      dataRef.current = detail
      setData(detail)
      setError(null)
      deferredRetryKeysRef.current.delete(cacheKey)
    } catch (requestError) {
      if (requestIdRef.current !== requestId) {
        return
      }

      const message =
        requestError instanceof Error ? requestError.message : 'Unknown backend failure'

      if (!gameDetailCache.has(cacheKey) && !hasVisibleSameGame) {
        setError(message)
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [clearDeferredRetry, range, universeId])

  useEffect(() => {
    if (universeId == null) {
      clearDeferredRetry()
      setData(null)
      setError(null)
      setIsLoading(false)
      setIsRefreshing(false)
      return
    }

    const cacheKey = getGameDetailCacheKey(universeId, range)
    const cached = gameDetailCache.get(cacheKey) ?? null
    const requestId = ++requestIdRef.current
    const hasVisibleSameGame = dataRef.current?.game.universeId === universeId

    clearDeferredRetry()
    setError(null)

    if (cached) {
      dataRef.current = cached
      setData(cached)
      setIsLoading(false)
      setIsRefreshing(false)
    } else if (hasVisibleSameGame) {
      setIsLoading(false)
      setIsRefreshing(true)
    } else {
      dataRef.current = null
      setData(null)
      setIsLoading(true)
      setIsRefreshing(false)
    }

    let cancelled = false

    const scheduleDeferredRetry = (detail: GameDetailResponse) => {
      if (!hasDeferredSupplemental(detail) || deferredRetryKeysRef.current.has(cacheKey)) {
        return
      }

      deferredRetryKeysRef.current.add(cacheKey)
      clearDeferredRetry()
      deferredRetryTimeoutRef.current = window.setTimeout(() => {
        deferredRetryTimeoutRef.current = null

        if (!cancelled && requestIdRef.current === requestId) {
          void refresh()
        }
      }, DEFERRED_RETRY_DELAY_MS)
    }

    const load = async () => {
      if (!cached) {
        try {
          const coreDetail = await fetchGameDetail(universeId, range, 'core')

          if (cancelled || requestIdRef.current !== requestId) {
            return
          }

          gameDetailCache.set(cacheKey, coreDetail)
          dataRef.current = coreDetail
          setData(coreDetail)
          setIsLoading(false)
          setIsRefreshing(hasVisibleSameGame)
        } catch (requestError) {
          if (cancelled || requestIdRef.current !== requestId) {
            return
          }

          const message =
            requestError instanceof Error ? requestError.message : 'Unknown backend failure'

          if (!hasVisibleSameGame) {
            setError(message)
          }

          setIsLoading(false)
          setIsRefreshing(false)
          return
        }
      } else {
        setIsRefreshing(true)
      }

      try {
        const fullDetail = await fetchGameDetail(universeId, range, 'full')

        if (cancelled || requestIdRef.current !== requestId) {
          return
        }

        gameDetailCache.set(cacheKey, fullDetail)
        dataRef.current = fullDetail
        setData(fullDetail)
        setError(null)

        if (!hasDeferredSupplemental(fullDetail)) {
          deferredRetryKeysRef.current.delete(cacheKey)
        } else {
          scheduleDeferredRetry(fullDetail)
        }
      } catch (requestError) {
        if (cancelled || requestIdRef.current !== requestId) {
          return
        }

        const message =
          requestError instanceof Error ? requestError.message : 'Unknown backend failure'

        if (!gameDetailCache.has(cacheKey) && !hasVisibleSameGame) {
          setError(message)
        }
      } finally {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    }

    void load()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, 60_000)

    return () => {
      cancelled = true
      clearDeferredRetry()
      window.clearInterval(intervalId)
    }
  }, [clearDeferredRetry, range, refresh, universeId])

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    refresh,
  }
}
