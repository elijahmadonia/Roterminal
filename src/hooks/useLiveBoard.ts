import { useCallback, useEffect, useState } from 'react'

import { fetchLiveBoard } from '../api/roblox'
import type { ChartRange, LiveBoardResponse } from '../types'

const liveBoardCache = new Map<ChartRange, LiveBoardResponse>()
const LIVE_BOARD_STORAGE_PREFIX = 'roterminal:live-board:'

function getBoardRefreshIntervalMs(range: ChartRange): number {
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

function readStoredBoard(range: ChartRange) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(`${LIVE_BOARD_STORAGE_PREFIX}${range}`)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as LiveBoardResponse
    liveBoardCache.set(range, parsed)
    return parsed
  } catch {
    return null
  }
}

function writeStoredBoard(range: ChartRange, board: LiveBoardResponse) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(`${LIVE_BOARD_STORAGE_PREFIX}${range}`, JSON.stringify(board))
  } catch {
    // Ignore storage failures; in-memory cache still helps.
  }
}

type LiveBoardState = {
  data: LiveBoardResponse | null
  error: string | null
  isLoading: boolean
  refresh: () => Promise<void>
}

export function useLiveBoard(
  range: ChartRange = '24h',
  enabled = true,
): LiveBoardState {
  const refreshIntervalMs = getBoardRefreshIntervalMs(range)
  const [data, setData] = useState<LiveBoardResponse | null>(
    () => liveBoardCache.get(range) ?? readStoredBoard(range),
  )
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(
    () => !liveBoardCache.has(range) && !readStoredBoard(range),
  )

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const board = await fetchLiveBoard(range)
      liveBoardCache.set(range, board)
      writeStoredBoard(range, board)
      setData(board)
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Unknown backend failure'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [range])

  useEffect(() => {
    if (!enabled) {
      return
    }

    const cachedBoard = liveBoardCache.get(range) ?? readStoredBoard(range)

    if (cachedBoard) {
      setData(cachedBoard)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }

    void refresh()

    const intervalId = window.setInterval(() => {
      void refresh()
    }, refreshIntervalMs)

    return () => window.clearInterval(intervalId)
  }, [enabled, range, refresh, refreshIntervalMs])

  return {
    data,
    error,
    isLoading,
    refresh,
  }
}
