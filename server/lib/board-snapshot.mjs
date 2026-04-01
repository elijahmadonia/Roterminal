import {
  INGEST_INTERVAL_MS,
  ONE_DAY_MS,
  ONE_HOUR_MS,
} from '../config.mjs'

const SIX_HOURS_MS = 6 * ONE_HOUR_MS
const THIRTY_MINUTES_MS = 30 * 60 * 1000
const ONE_WEEK_MS = 7 * ONE_DAY_MS
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS
const CHART_RANGE_MS = {
  '30m': THIRTY_MINUTES_MS,
  '1h': ONE_HOUR_MS,
  '6h': SIX_HOURS_MS,
  '24h': ONE_DAY_MS,
  '7d': ONE_WEEK_MS,
  '30d': THIRTY_DAYS_MS,
}
const OFFICIAL_PLATFORM_SCALE = {
  value: '45M',
  dateLabel: 'Jan 13, 2026',
}
const PLATFORM_SORT_IDS = [
  'top-playing-now',
  'top-trending',
  'up-and-coming',
  'top-revisited',
]
const BOARD_LEADERBOARD_LIMIT = 500
export const BOARD_WATCHLIST_LIMIT = 200

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value)
}

function formatWholeNumber(value) {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatApproval(value) {
  return `${value.toFixed(1)}% liked`
}

function formatRelativeUpdate(value) {
  const updatedAt = new Date(value)
  const diffMs = Date.now() - updatedAt.getTime()
  const diffHours = Math.max(Math.round(diffMs / ONE_HOUR_MS), 0)

  if (diffHours < 1) {
    return 'Updated <1h ago'
  }

  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`
  }

  return `Updated ${Math.round(diffHours / 24)}d ago`
}

function getToneFromDelta(delta) {
  if (delta > 2) return 'positive'
  if (delta < -2) return 'negative'
  return 'neutral'
}

function getToneFromApproval(approval) {
  if (approval >= 85) return 'positive'
  if (approval <= 70) return 'negative'
  return 'neutral'
}

function getHistoryCutoffIsoForWindow(windowMs, paddingMs = ONE_HOUR_MS) {
  const safeWindowMs = Number.isFinite(windowMs) ? Math.max(windowMs, ONE_HOUR_MS) : ONE_HOUR_MS
  return new Date(Date.now() - safeWindowMs - Math.max(paddingMs, 0)).toISOString()
}

export function getBoardHistoryCutoffIso(range = '24h') {
  return getHistoryCutoffIsoForWindow(
    Math.max(CHART_RANGE_MS[range] ?? ONE_DAY_MS, ONE_WEEK_MS),
    6 * ONE_HOUR_MS,
  )
}

function formatTrendLabel(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function limitTrendPoints(points, maxPoints) {
  if (points.length <= maxPoints) {
    return points
  }

  if (maxPoints <= 2) {
    return [points[0], points.at(-1)].filter(Boolean)
  }

  const firstPoint = points[0]
  const lastPoint = points.at(-1)
  const interior = points.slice(1, -1)
  const bucketCount = Math.min(
    interior.length,
    Math.max(1, Math.floor((maxPoints - 2) / 2)),
  )
  const limited = [firstPoint]

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    const startIndex = Math.floor((bucketIndex / bucketCount) * interior.length)
    const endIndex = Math.floor(((bucketIndex + 1) / bucketCount) * interior.length)
    const bucket = interior.slice(startIndex, endIndex)

    if (bucket.length === 0) {
      continue
    }

    let minPoint = bucket[0]
    let maxPoint = bucket[0]

    for (const point of bucket) {
      if (point.value < minPoint.value) {
        minPoint = point
      }

      if (point.value > maxPoint.value) {
        maxPoint = point
      }
    }

    if (minPoint === maxPoint) {
      limited.push(minPoint)
      continue
    }

    if (new Date(minPoint.timestamp).getTime() <= new Date(maxPoint.timestamp).getTime()) {
      limited.push(minPoint, maxPoint)
    } else {
      limited.push(maxPoint, minPoint)
    }
  }

  if (lastPoint) {
    limited.push(lastPoint)
  }

  const deduped = []
  const seenTimestamps = new Set()

  for (const point of limited) {
    if (!point?.timestamp || seenTimestamps.has(point.timestamp)) {
      continue
    }

    seenTimestamps.add(point.timestamp)
    deduped.push(point)
  }

  return deduped
}

function getMaxTrendPoints(range) {
  switch (range) {
    case '30m':
      return 24
    case '1h':
      return 36
    case '6h':
      return 72
    case '24h':
      return 96
    case '7d':
      return 120
    case '30d':
      return 160
    default:
      return 96
  }
}

function findBaseline(history, cutoffMs) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (new Date(entry.timestamp).getTime() <= cutoffMs) {
      return entry
    }
  }

  return history[0] ?? null
}

function computeDeltaPercent(current, baseline) {
  if (!baseline || baseline.playing === 0) {
    return 0
  }

  return ((current.playing - baseline.playing) / baseline.playing) * 100
}

function getMostRecentSaturdayStartMs(referenceMs = Date.now()) {
  const date = new Date(referenceMs)
  const day = date.getDay()
  const daysSinceSaturday = (day + 1) % 7

  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysSinceSaturday)

  return date.getTime()
}

function findPeakPlayingInWindow(history, startMs, endMs) {
  let peakPlaying = 0

  for (const entry of history) {
    const observedAt = new Date(entry.timestamp).getTime()

    if (observedAt < startMs || observedAt >= endMs) {
      continue
    }

    peakPlaying = Math.max(peakPlaying, Number(entry.playing) || 0)
  }

  return peakPlaying
}

function computeValueDeltaPercent(currentValue, baselineValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || baselineValue <= 0) {
    return 0
  }

  return ((currentValue - baselineValue) / baselineValue) * 100
}

function getUpdateStatus(updated) {
  const hours = (Date.now() - new Date(updated).getTime()) / ONE_HOUR_MS
  if (hours <= 6) return 'live'
  if (hours <= 24) return 'rolling'
  return 'scheduled'
}

function buildSparkline(history, currentPlaying, now = Date.now()) {
  const cutoffMs = now - ONE_DAY_MS
  const points = history
    .filter((entry) => new Date(entry.timestamp).getTime() >= cutoffMs)
    .map((entry) => ({
      timestamp: entry.timestamp,
      value: entry.playing,
    }))

  points.push({
    timestamp: new Date(now).toISOString(),
    value: currentPlaying,
  })

  const values = limitTrendPoints(points, 12).map((point) => point.value)

  if (values.length === 1) {
    return [values[0], values[0]]
  }

  return values
}

function enrichGames(games, historyMap) {
  const now = Date.now()
  const currentWeekStartMs = getMostRecentSaturdayStartMs(now)
  const previousWeekStartMs = currentWeekStartMs - ONE_WEEK_MS
  const sortedGames = [...games].sort((left, right) => right.playing - left.playing)

  return sortedGames.map((game) => {
    const fullHistory = historyMap.get(game.universeId) ?? []
    const priorHistory = fullHistory.slice(0, -1)
    const observedPoints = [
      ...priorHistory,
      {
        timestamp: new Date(now).toISOString(),
        playing: game.playing,
      },
    ]
    const baseline1h = findBaseline(priorHistory, now - ONE_HOUR_MS)
    const baseline6h = findBaseline(priorHistory, now - SIX_HOURS_MS)
    const baseline24h = findBaseline(priorHistory, now - ONE_DAY_MS)
    const delta1h = computeDeltaPercent(game, baseline1h)
    const delta6h = computeDeltaPercent(game, baseline6h)
    const delta24h = computeDeltaPercent(game, baseline24h)
    const currentWeekPeak = findPeakPlayingInWindow(observedPoints, currentWeekStartMs, now + 1)
    const previousWeekPeak = findPeakPlayingInWindow(
      priorHistory,
      previousWeekStartMs,
      currentWeekStartMs,
    )
    const hasPreviousWeekHistory = previousWeekPeak > 0
    const deltaWeek = hasPreviousWeekHistory
      ? computeValueDeltaPercent(currentWeekPeak, previousWeekPeak)
      : delta24h
    const favoriteDelta =
      baseline24h != null ? game.favoritedCount - baseline24h.favorited_count : 0
    const tone =
      Math.abs(delta1h) >= 0.5 ? getToneFromDelta(delta1h) : getToneFromApproval(game.approval)

    return {
      ...game,
      history: priorHistory,
      delta1h,
      delta6h,
      delta24h,
      deltaWeek,
      favoriteDelta,
      tone,
      sparkline: buildSparkline(priorHistory, game.playing, now),
      updateStatus: getUpdateStatus(game.updated),
    }
  })
}

function buildTimeline(historyMap, universeIds, games, range = '24h') {
  const cutoffMs = Date.now() - CHART_RANGE_MS[range]
  const timestamps = [...new Set(
    universeIds.flatMap((universeId) =>
      (historyMap.get(universeId) ?? [])
        .map((entry) => entry.timestamp)
        .filter((timestamp) => new Date(timestamp).getTime() >= cutoffMs),
    ),
  )]
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())

  const chartPoints = timestamps.map((timestamp) => {
    const atTime = new Date(timestamp).getTime()
    const value = universeIds.reduce((sum, universeId) => {
      const history = historyMap.get(universeId) ?? []
      let latestPlaying = 0

      for (const entry of history) {
        if (new Date(entry.timestamp).getTime() <= atTime) {
          latestPlaying = entry.playing
        } else {
          break
        }
      }

      return sum + latestPlaying
    }, 0)

    return {
      label: formatTrendLabel(timestamp),
      timestamp,
      value,
    }
  })

  chartPoints.push({
    label: formatTrendLabel(new Date().toISOString()),
    timestamp: new Date().toISOString(),
    value: games.reduce((sum, game) => sum + game.playing, 0),
  })

  return limitTrendPoints(chartPoints, getMaxTrendPoints(range))
}

function detectEvents(enrichedGames) {
  return enrichedGames
    .flatMap((game) => {
      const events = []
      const hoursSinceUpdate = (Date.now() - new Date(game.updated).getTime()) / ONE_HOUR_MS
      const priorVisits = game.history.at(-1)?.visits ?? game.visits
      const currentVisitMilestone = Math.floor(game.visits / 1_000_000_000)
      const previousVisitMilestone = Math.floor(priorVisits / 1_000_000_000)

      if (hoursSinceUpdate <= 12) {
        events.push({
          title: `${game.name} pushed a recent update window`,
          detail: `${formatRelativeUpdate(game.updated)} with a ${game.delta6h >= 0 ? '+' : ''}${game.delta6h.toFixed(1)}% 6-hour move.`,
          timestamp: formatRelativeUpdate(game.updated).replace('Updated ', ''),
          tone: game.delta6h >= 0 ? 'positive' : 'neutral',
          category: 'update',
          weight: 3,
        })
      }

      if (game.delta1h >= 5) {
        events.push({
          title: `${game.name} is breaking upward on short-window traffic`,
          detail: `Up ${game.delta1h.toFixed(1)}% in the last hour to ${formatWholeNumber(game.playing)} live players.`,
          timestamp: '1h window',
          tone: 'positive',
          category: 'spike',
          weight: 4,
        })
      }

      if (game.delta1h <= -5) {
        events.push({
          title: `${game.name} is unwinding after a sharp traffic move`,
          detail: `${Math.abs(game.delta1h).toFixed(1)}% lower over the last hour, now at ${formatWholeNumber(game.playing)} live players.`,
          timestamp: '1h window',
          tone: 'negative',
          category: 'pullback',
          weight: 4,
        })
      }

      if (currentVisitMilestone > previousVisitMilestone && currentVisitMilestone > 0) {
        events.push({
          title: `${game.name} crossed ${currentVisitMilestone}B lifetime visits`,
          detail: `A long-range demand milestone that usually only shows up in titles with durable chart presence.`,
          timestamp: 'Visit milestone',
          tone: 'positive',
          category: 'milestone',
          weight: 2,
        })
      }

      return events.map((event) => ({
        universeId: game.universeId,
        ...event,
      }))
    })
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 8)
    .map(({ weight: _weight, ...event }) => event)
}

function buildSingleGameTimeline(game, range = '24h') {
  const cutoffMs = Date.now() - CHART_RANGE_MS[range]
  const points = [
    ...game.history.map((entry) => ({
      timestamp: entry.timestamp,
      value: entry.playing,
    })),
    {
      timestamp: new Date().toISOString(),
      value: game.playing,
    },
  ].filter((point) => new Date(point.timestamp).getTime() >= cutoffMs)

  return limitTrendPoints(points, getMaxTrendPoints(range)).map((point) => ({
    label: formatTrendLabel(point.timestamp),
    timestamp: point.timestamp,
    value: point.value,
  }))
}

export function buildBoardPayload({
  games,
  historyMap,
  source = 'live',
  range = '24h',
  trackedGames = null,
  platformMeta = null,
  lastIngestedAt = null,
  ingestIntervalMs = INGEST_INTERVAL_MS,
}) {
  const enrichedGames = enrichGames(games, historyMap)
  const trackedEnrichedGames = trackedGames
    ? enrichGames(
        trackedGames.games,
        trackedGames.historyMap,
      )
    : enrichedGames

  if (enrichedGames.length === 0) {
    return {
      status: {
        label: 'Live Roblox feed empty',
        detail: 'No universes are currently returning game data.',
        tone: 'negative',
      },
      ops: {
        source,
        ingestIntervalMinutes: Math.round(ingestIntervalMs / 60_000),
        lastIngestedAt,
      },
      metrics: [],
      leaderboard: [],
      topExperiences: [],
      watchlist: [],
      summaryFeed: [],
      trendingNow: [],
      timeline: [],
      eventFeed: [],
      genreHeatmap: [],
      updateCalendar: [],
      developerBoard: [],
      alertQueue: [],
    }
  }

  const totalPlaying = enrichedGames.reduce((sum, game) => sum + game.playing, 0)
  const leadMover = [...enrichedGames].sort(
    (left, right) => Math.abs(right.delta1h) - Math.abs(left.delta1h),
  )[0]
  const topMoverDown = [...enrichedGames].sort((left, right) => left.delta1h - right.delta1h)[0]
  const freshestUpdate = [...enrichedGames].sort(
    (left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime(),
  )[0]
  const strongestApproval = [...enrichedGames].sort(
    (left, right) => right.approval - left.approval,
  )[0]

  const developers = Array.from(
    enrichedGames.reduce((map, game) => {
      const key = `${game.creatorType}:${game.creatorName}`
      const current = map.get(key) ?? {
        name: game.creatorName,
        studioType: game.creatorType,
        totalVisits: 0,
        liveCCU: 0,
        flagship: game.name,
        flagshipCCU: 0,
        avgDelta1h: 0,
        titles: 0,
      }

      current.totalVisits += game.visits
      current.liveCCU += game.playing
      current.avgDelta1h += game.delta1h
      current.titles += 1
      if (game.playing > current.flagshipCCU) {
        current.flagship = game.name
        current.flagshipCCU = game.playing
      }
      map.set(key, current)
      return map
    }, new Map()).values(),
  )
    .sort((left, right) => right.liveCCU - left.liveCCU)
    .slice(0, 5)
    .map((developer) => ({
      name: developer.name,
      studioType: developer.studioType,
      flagship: developer.flagship,
      totalVisits: `${formatCompactNumber(developer.totalVisits)} visits`,
      liveCCU: `${formatCompactNumber(developer.liveCCU)} live CCU`,
    }))

  const genres = Array.from(
    enrichedGames.reduce((map, game) => {
      const key = game.genre || 'Unclassified'
      const bucket = map.get(key) ?? { name: key, totalCCU: 0, deltaWeek: 0, experiences: [] }
      bucket.totalCCU += game.playing
      bucket.deltaWeek += game.deltaWeek
      bucket.experiences.push(game)
      map.set(key, bucket)
      return map
    }, new Map()).values(),
  )
    .sort((left, right) => right.totalCCU - left.totalCCU)
    .map((bucket) => ({
      name: bucket.name,
      ccuLabel: `${formatCompactNumber(bucket.totalCCU)} combined CCU`,
      change: bucket.experiences.length > 0 ? bucket.deltaWeek / bucket.experiences.length : 0,
      tone: getToneFromDelta(bucket.deltaWeek),
      experiences: bucket.experiences.map((game) => ({
        universeId: game.universeId,
        name: game.name,
        change: game.deltaWeek,
        weight: Math.max(game.playing, 1),
        tone: getToneFromDelta(game.deltaWeek),
      })),
    }))

  const boardLeader = enrichedGames[0]
  const boardLeaderShare = (boardLeader.playing / totalPlaying) * 100
  const timeline = buildTimeline(
    historyMap,
    enrichedGames.map((game) => game.universeId),
    enrichedGames,
    range,
  )
  const eventFeed = detectEvents(enrichedGames)

  const summaryFeed = [
    {
      title: `${leadMover.name} is the strongest live mover on the board at ${leadMover.delta1h >= 0 ? '+' : ''}${leadMover.delta1h.toFixed(1)}%.`,
      detail: `${leadMover.name} is now at ${formatWholeNumber(leadMover.playing)} live players, with a ${leadMover.delta6h >= 0 ? '+' : ''}${leadMover.delta6h.toFixed(1)}% move across the last 6 hours.`,
      datapoints: '1h + 6h snapshot windows',
    },
    {
      title: `${freshestUpdate.name} is the freshest tracked update and is currently ${freshestUpdate.delta6h >= 0 ? 'holding' : 'losing'} traffic.`,
      detail: `${formatRelativeUpdate(freshestUpdate.updated)}. The latest 6-hour move is ${freshestUpdate.delta6h >= 0 ? '+' : ''}${freshestUpdate.delta6h.toFixed(1)}%, which is a better launch-read than a single snapshot jump.`,
      datapoints: 'update recency + 6h delta',
    },
    {
      title: `${boardLeader.name} controls ${boardLeaderShare.toFixed(1)}% of tracked live demand.`,
      detail: `The board is still concentrated around a handful of large experiences, which means one title can distort the platform picture if you are not checking share alongside raw CCU.`,
      datapoints: 'board concentration',
    },
  ]

  const trendingNow = [
    {
      universeId: leadMover.universeId,
      title: `${leadMover.name} is ${leadMover.delta1h >= 0 ? 'accelerating' : 'sliding'} faster than the rest of the tracked board.`,
      timestamp: formatRelativeUpdate(freshestUpdate.updated).replace('Updated ', ''),
      summary: `${formatWholeNumber(leadMover.playing)} live players, ${leadMover.delta1h >= 0 ? '+' : ''}${leadMover.delta1h.toFixed(1)}% in the last hour, ${leadMover.delta24h >= 0 ? '+' : ''}${leadMover.delta24h.toFixed(1)}% across the day.`,
      source: `${leadMover.creatorName} · ${leadMover.genre}`,
      tone: leadMover.tone,
    },
    {
      universeId: topMoverDown.universeId,
      title: `${topMoverDown.name} is the clearest downside move in the current watch window.`,
      timestamp: formatRelativeUpdate(topMoverDown.updated).replace('Updated ', ''),
      summary: `${formatWholeNumber(topMoverDown.playing)} live players and ${topMoverDown.delta1h.toFixed(1)}% over the last hour. This is a stronger alert candidate than games that only slipped once.`,
      source: `${topMoverDown.creatorName} · ${topMoverDown.genre}`,
      tone: topMoverDown.tone,
    },
    {
      universeId: strongestApproval.universeId,
      title: `${strongestApproval.name} still leads approval while holding scale.`,
      timestamp: formatRelativeUpdate(strongestApproval.updated).replace('Updated ', ''),
      summary: `${formatApproval(strongestApproval.approval)} with ${formatCompactNumber(strongestApproval.visits)} lifetime visits and ${formatWholeNumber(strongestApproval.playing)} live players.`,
      source: `${strongestApproval.creatorName} · approval durability`,
      tone: getToneFromApproval(strongestApproval.approval),
    },
  ]

  const alertCandidates = enrichedGames
    .flatMap((game) => {
      const hoursSinceUpdate = (Date.now() - new Date(game.updated).getTime()) / ONE_HOUR_MS
      const alerts = []

      if (Math.abs(game.delta1h) >= 8) {
        alerts.push({
          title: `${game.name} ${game.delta1h >= 0 ? 'spiked' : 'dropped'} ${Math.abs(game.delta1h).toFixed(1)}% in the last hour`,
          rule: `${formatWholeNumber(game.playing)} live players · ${game.delta24h >= 0 ? '+' : ''}${game.delta24h.toFixed(1)}% across the last day`,
          severity: 'critical',
          weight: 3,
        })
      }

      if (hoursSinceUpdate <= 12 && Math.abs(game.delta6h) >= 3) {
        alerts.push({
          title: `${game.name} is reacting to a recent update window`,
          rule: `${formatRelativeUpdate(game.updated)} · ${game.delta6h >= 0 ? '+' : ''}${game.delta6h.toFixed(1)}% across 6 hours`,
          severity: 'watch',
          weight: 2,
        })
      }

      if (game.approval >= 90 && game.playing >= 50_000) {
        alerts.push({
          title: `${game.name} is holding high approval at scale`,
          rule: `${formatApproval(game.approval)} · ${formatWholeNumber(game.playing)} current players`,
          severity: 'info',
          weight: 1,
        })
      }

      return alerts
    })
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 4)
    .map(({ weight: _weight, ...alert }) => alert)

  const alertQueue = alertCandidates.length > 0
    ? alertCandidates
    : [
        {
          title: `${strongestApproval.name} leads board quality`,
          rule: `${formatApproval(strongestApproval.approval)} with stable live demand`,
          severity: 'info',
        },
      ]

  return {
    status: {
      label:
        source === 'live'
          ? 'Live Roblox feed online'
          : source === 'cache'
            ? 'Live Roblox feed degraded'
            : 'Database fallback active',
      detail:
        source === 'live'
          ? `${formatCompactNumber(totalPlaying)} live players across ${enrichedGames.length} indexed experiences · 5 minute ingestion`
          : source === 'cache'
            ? `Using recent cached Roblox surface data across ${enrichedGames.length} live experiences`
            : `Serving ${enrichedGames.length} indexed experiences from stored snapshots while upstream is unavailable`,
      tone: source === 'live' ? 'positive' : 'neutral',
    },
    metrics: [
      {
        label: 'Observed live CCU',
        value: formatCompactNumber(totalPlaying),
        change: `${enrichedGames.length} games indexed`,
        footnote: 'Aggregate concurrent users across the live Roblox surface set',
        tone: 'positive',
      },
      {
        label: 'Games indexed',
        value: formatWholeNumber(enrichedGames.length),
        change: `${platformMeta?.discoveredSorts?.length ?? PLATFORM_SORT_IDS.length} live sorts`,
        footnote: 'Unique experiences currently covered from Roblox discovery and Home feeds',
        tone: 'neutral',
      },
      {
        label: 'Genres indexed',
        value: formatWholeNumber(genres.length),
        change: genres[0]?.name ?? 'Unclassified',
        footnote: 'Genre families represented in the indexed live universe set',
        tone: 'neutral',
      },
      {
        label: 'Official platform scale',
        value: OFFICIAL_PLATFORM_SCALE.value,
        change: OFFICIAL_PLATFORM_SCALE.dateLabel,
        footnote: 'Latest official Roblox concurrency milestone, separate from current surface coverage',
        tone: 'positive',
      },
    ],
    ops: {
      source,
      ingestIntervalMinutes: Math.round(ingestIntervalMs / 60_000),
      lastIngestedAt,
    },
    leaderboard: enrichedGames.slice(0, BOARD_LEADERBOARD_LIMIT).map((game) => ({
      universeId: game.universeId,
      name: game.name,
      creatorName: game.creatorName,
      genre: game.genre,
      playing: game.playing,
      visits: game.visits,
      approval: Number(game.approval.toFixed(1)),
      updated: game.updated,
      delta1h: Number(game.delta1h.toFixed(1)),
      delta24h: Number(game.delta24h.toFixed(1)),
      deltaWeek: Number(game.deltaWeek.toFixed(1)),
      tone: game.tone,
      sparkline: game.sparkline,
      thumbnailUrl: game.thumbnailUrl,
    })),
    topFiveSeries: enrichedGames.slice(0, 5).map((game) => ({
      universeId: game.universeId,
      timeline: buildSingleGameTimeline(game, range),
    })),
    topExperiences: enrichedGames.slice(0, 4).map((game) => ({
      universeId: game.universeId,
      name: game.name,
      genre: game.genre,
      ccu: `${formatWholeNumber(game.playing)} CCU`,
      badge: `${game.delta1h >= 0 ? '+' : ''}${game.delta1h.toFixed(1)}%`,
      context: `${game.creatorName} · ${formatCompactNumber(game.visits)} visits · ${formatRelativeUpdate(game.updated)}`,
      sparkline: game.sparkline,
      thumbnailUrl: game.thumbnailUrl,
      tone: game.tone,
    })),
    watchlist: trackedEnrichedGames.slice(0, BOARD_WATCHLIST_LIMIT).map((game) => ({
      universeId: game.universeId,
      name: game.name,
      creator: game.creatorName,
      ccu: formatWholeNumber(game.playing),
      change: Number(game.approval.toFixed(1)),
      tone: getToneFromApproval(game.approval),
    })),
    summaryFeed,
    trendingNow,
    timeline,
    eventFeed,
    genreHeatmap: genres,
    updateCalendar: [...enrichedGames]
      .sort((left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime())
      .slice(0, 8)
      .map((game) => ({
        universeId: game.universeId,
        experience: game.name,
        genre: game.genre,
        eta: formatRelativeUpdate(game.updated),
        expectedImpact:
          game.delta6h >= 0
            ? `${game.delta6h.toFixed(1)}% gain across the 6-hour watch window`
            : `${Math.abs(game.delta6h).toFixed(1)}% pullback across the 6-hour watch window`,
        status: game.updateStatus,
      })),
    developerBoard: developers,
    alertQueue,
  }
}
