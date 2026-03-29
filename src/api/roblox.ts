import type {
  ChartRange,
  GameDetailResponse,
  LiveValuePoint,
  LiveBoardResponse,
  LivePlatformResponse,
  ScreenerResponse,
} from '../types'

const BACKEND_API_BASE = '/api'
const ROBLOX_API_BASE = '/api/roblox'

interface RobloxGamesResponse {
  data: Array<{
    id: number
  }>
}

interface RobloxUniverseResponse {
  universeId: number
}

export interface RobloxSearchMatch {
  universeId: number
  rootPlaceId: number
  name: string
  creatorName: string
  playerCount: number
  approval: number
}

interface RobloxSearchResponse {
  matches: RobloxSearchMatch[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export async function fetchLiveBoard(
  range: ChartRange = '24h',
): Promise<LiveBoardResponse> {
  return fetchJson<LiveBoardResponse>(
    `${BACKEND_API_BASE}/live/board?range=${range}`,
  )
}

export async function fetchLivePlatform(
  range: ChartRange = '24h',
): Promise<LivePlatformResponse> {
  return fetchJson<LivePlatformResponse>(
    `${BACKEND_API_BASE}/live/platform?range=${range}`,
  )
}

export async function fetchBoardLivePoint(): Promise<LiveValuePoint> {
  return fetchJson<LiveValuePoint>(
    `${BACKEND_API_BASE}/live/board-point`,
  )
}

export async function fetchPlatformLivePoint(): Promise<LiveValuePoint> {
  return fetchJson<LiveValuePoint>(
    `${BACKEND_API_BASE}/live/platform-point`,
  )
}

export async function fetchGameDetail(
  universeId: number,
  range: ChartRange = '24h',
  detailLevel: 'core' | 'full' = 'full',
): Promise<GameDetailResponse> {
  return fetchJson<GameDetailResponse>(
    `${BACKEND_API_BASE}/game-page/${universeId}?range=${range}&detail=${detailLevel}`,
  )
}

export async function fetchGameLivePoint(
  universeId: number,
): Promise<LiveValuePoint> {
  return fetchJson<LiveValuePoint>(
    `${BACKEND_API_BASE}/live/game/${universeId}`,
  )
}

export async function runScreenerQuery(query: string): Promise<ScreenerResponse> {
  return fetchJson<ScreenerResponse>(
    `${BACKEND_API_BASE}/screener?query=${encodeURIComponent(query)}`,
  )
}

export async function searchRobloxGamesByName(
  query: string,
): Promise<RobloxSearchMatch[]> {
  return fetchJson<RobloxSearchResponse>(
    `${BACKEND_API_BASE}/search?query=${encodeURIComponent(query)}`,
  ).then((response) => response.matches)
}

function extractPlaceId(input: string): number | null {
  const trimmed = input.trim()
  const urlMatch =
    trimmed.match(/roblox\.com\/games\/(\d+)/i) ??
    trimmed.match(/[?&]placeId=(\d+)/i)

  if (urlMatch) {
    return Number(urlMatch[1])
  }

  return null
}

async function resolvePlaceToUniverse(placeId: number): Promise<number> {
  const response = await fetchJson<RobloxUniverseResponse>(
    `/api/roblox-universes/universes/v1/places/${placeId}/universe`,
  )

  return response.universeId
}

async function universeExists(universeId: number): Promise<boolean> {
  const response = await fetchJson<RobloxGamesResponse>(
    `${ROBLOX_API_BASE}/games?universeIds=${universeId}`,
  )

  return response.data.length > 0
}

export async function resolveUniverseId(input: string): Promise<number> {
  const placeId = extractPlaceId(input)

  if (placeId) {
    return resolvePlaceToUniverse(placeId)
  }

  const numericValue = Number(input.trim())

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    const matches = await searchRobloxGamesByName(input.trim())

    if (matches.length === 0) {
      throw new Error('No Roblox experience matched that name.')
    }

    return matches[0].universeId
  }

  if (await universeExists(numericValue)) {
    return numericValue
  }

  return resolvePlaceToUniverse(numericValue)
}
