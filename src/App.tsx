import { useEffect, useState } from 'react'

import { resolveUniverseId } from './api/roblox'
import AppShell from './components/AppShell'
import { useGameDetail } from './hooks/useGameDetail'
import ComponentsPage from './pages/ComponentsPage'
import GamePage from './pages/GamePage'
import HomePage from './pages/HomePage'
import type { ChartRange } from './types'
import './App.css'

type AppRoute =
  | { kind: 'home' }
  | { kind: 'components' }
  | { kind: 'game'; universeId: number }

const gameChartRanges: ChartRange[] = ['30m', '1h', '6h', '24h', '7d', '30d']

function parseRoute(pathname: string): AppRoute {
  if (pathname === '/') {
    return { kind: 'home' }
  }

  if (pathname === '/components') {
    return { kind: 'components' }
  }

  const gameMatch = pathname.match(/^\/games\/(\d+)$/)
  if (gameMatch) {
    return { kind: 'game', universeId: Number(gameMatch[1]) }
  }

  return { kind: 'home' }
}

function gamePath(universeId: number) {
  return `/games/${universeId}`
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname))
  const [gameChartRange, setGameChartRange] = useState<ChartRange>('24h')

  const selectedGameId = route.kind === 'game' ? route.universeId : null
  const {
    data: gameDetail,
    error: gameError,
    isLoading: isGameLoading,
    isRefreshing: isGameRefreshing,
  } = useGameDetail(selectedGameId, gameChartRange)

  useEffect(() => {
    const handlePopState = () => {
      setRoute(parseRoute(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigateTo = (nextRoute: AppRoute, pathname: string) => {
    if (window.location.pathname !== pathname) {
      window.history.pushState({}, '', pathname)
    }
    setRoute(nextRoute)
  }

  const navigateToHome = () => {
    navigateTo({ kind: 'home' }, '/')
  }

  const navigateToComponents = () => {
    navigateTo({ kind: 'components' }, '/components')
  }

  const navigateToGame = (universeId: number) => {
    navigateTo({ kind: 'game', universeId }, gamePath(universeId))
  }

  const openHomeGame = async ({
    universeId,
    name,
  }: {
    universeId?: number
    name: string
  }) => {
    try {
      if (universeId) {
        navigateToGame(universeId)
        return
      }

      const resolvedUniverseId = await resolveUniverseId(name)
      navigateToGame(resolvedUniverseId)
    } catch (error) {
      console.error(error)
      throw error
    }
  }

  let pageContent

  if (route.kind === 'components') {
    pageContent = <ComponentsPage />
  }
  else if (route.kind === 'game') {
    pageContent = (
      <GamePage
        gameDetail={gameDetail}
        isLoading={isGameLoading}
        isRefreshing={isGameRefreshing}
        error={gameError}
        chartRange={gameChartRange}
        availableRanges={gameChartRanges}
        onChangeRange={setGameChartRange}
      />
    )
  } else {
    pageContent = (
      <HomePage
        onOpenGame={openHomeGame}
      />
    )
  }

  return (
    <AppShell
      activeRoute={route.kind}
      onOpenHome={navigateToHome}
      onOpenComponents={navigateToComponents}
      onOpenGame={openHomeGame}
    >
      {pageContent}
    </AppShell>
  )
}
