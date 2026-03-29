export type Tone = 'positive' | 'negative' | 'neutral'
export type ChartRange = '30m' | '1h' | '6h' | '24h' | '7d' | '30d'

export type TabId =
  | 'overview'
  | 'watchlist'
  | 'genres'
  | 'updates'
  | 'screener'
  | 'developers'
export interface MetricCard {
  label: string
  value: string
  change: string
  footnote: string
  tone: Tone
}

export interface TickerCard {
  universeId?: number
  name: string
  genre: string
  ccu: string
  badge: string
  context: string
  sparkline?: number[]
  thumbnailUrl?: string
  tone: Tone
}

export interface SummaryItem {
  title: string
  detail: string
  datapoints: string
}

export interface TrendingItem {
  universeId?: number
  title: string
  timestamp: string
  summary: string
  source: string
  tone: Tone
}

export interface HeatmapEntry {
  universeId?: number
  name: string
  change: number
  weight: number
  tone: Tone
}

export interface HeatmapBucket {
  name: string
  ccuLabel: string
  change: number
  tone: Tone
  experiences: HeatmapEntry[]
}

export interface UpdateRow {
  universeId?: number
  experience: string
  genre: string
  eta: string
  expectedImpact: string
  status: 'live' | 'rolling' | 'scheduled'
}

export interface DeveloperRow {
  name: string
  studioType: string
  totalVisits: string
  liveCCU: string
  flagship: string
}

export interface WatchlistRow {
  universeId?: number
  name: string
  creator: string
  ccu: string
  change: number
  tone: Tone
}

export interface AlertRow {
  title: string
  rule: string
  severity: 'critical' | 'watch' | 'info'
}

export interface TrendPoint {
  label: string
  value: number
  timestamp?: string
}

export interface LiveValuePoint {
  universeId?: number
  value: number
  timestamp: string
  source: 'live' | 'cache' | 'database'
}

export interface PlatformPeakPoint {
  value: number
  timestamp: string
}

export interface EventRow {
  universeId?: number
  title: string
  detail: string
  timestamp: string
  tone: Tone
  category: 'update' | 'spike' | 'drop' | 'milestone'
}

export interface OpsSnapshot {
  source: 'live' | 'cache' | 'database'
  ingestIntervalMinutes: number
  lastIngestedAt: string | null
}

export interface DetailStatRow {
  label: string
  value: string
}

export interface DetailIssueRow {
  title: string
  bullish: string
  bearish: string
}

export interface DetailAvailability {
  status: 'available' | 'partial' | 'unavailable'
  source: string
  note: string | null
}

export interface DetailInventoryItem {
  id: number | null
  name: string
  price: number | null
}

export interface DetailPageMeta extends DetailAvailability {
  sellerName?: string | null
  sellerId?: number | null
  rootPlaceId?: number | null
  canCreateServer?: boolean | null
  privateServerPrice?: number | null
  privateServerProductId?: number | null
  seoImageUrl?: string | null
}

export interface DetailCreatorProfile extends DetailAvailability {
  profileUrl?: string
  id?: number
  type?: 'User' | 'Group'
  name?: string
  displayName?: string
  description?: string
  hasVerifiedBadge?: boolean
  memberCount?: number | null
  created?: string | null
  owner?: {
    userId: number
    username: string
    displayName: string
    hasVerifiedBadge: boolean
  } | null
}

export interface DetailPortfolioGame {
  universeId: number
  rootPlaceId: number | null
  name: string
  genre: string
  playing: number | null
  visits: number | null
  updated: string | null
  created: string | null
  thumbnailUrl?: string
}

export interface DetailCreatorPortfolio extends DetailAvailability {
  totalCount: number
  games: DetailPortfolioGame[]
}

export interface DetailServerSample extends DetailAvailability {
  pageCount?: number
  sampledServerCount?: number
  sampledPlayerCount?: number
  exactActiveServerCount?: number | null
  estimatedActiveServerCount?: number | null
  averagePlayersPerServer?: number
  fillRate?: number
  servers?: Array<{
    id: string
    playing: number
    maxPlayers: number
    ping: number | null
    fps: number | null
  }>
}

export interface DetailStoreInventory extends DetailAvailability {
  totalCount: number
  items: DetailInventoryItem[]
}

export interface DetailAgeRating extends DetailAvailability {
  label?: string | null
  minimumAge?: number | null
  displayName?: string | null
  descriptors?: string[]
}

export interface DetailFinancialRange {
  low: number | null
  mid: number | null
  high: number | null
}

export interface DetailFinancialMetrics extends DetailAvailability {
  confidence: 'high' | 'medium' | 'low'
  estimatedRevenuePerVisit: DetailFinancialRange
  estimatedDailyRevenueUsd: DetailFinancialRange
  estimatedMonthlyRevenueUsd: DetailFinancialRange
  estimatedAnnualRunRateUsd: DetailFinancialRange
  estimatedValuationUsd: DetailFinancialRange
  methodology: string[]
}

export interface DetailGrowthWindow {
  ccu: number | null
  visits: number | null
  revenue: number | null
}

export interface DetailGrowthMetrics extends DetailAvailability {
  observedHistoryHours: number
  growth7d: DetailGrowthWindow
  growth30d: DetailGrowthWindow
  growth90d: DetailGrowthWindow
  classification: string
  daysSinceLastUpdate: number
  genreAverageGrowth30d: number | null
}

export interface DetailPlayerMetrics extends DetailAvailability {
  currentCCU: number
  estimatedDAU: number | null
  estimatedMAU: number | null
  peakCCUObserved: number | null
  peakCCU30dObserved: number | null
  averageSessionLengthMinutes: number | null
  dailyVisitsObserved: number | null
  hourlyHeatmap: Array<{
    hour: number
    averageCCU: number
  }>
}

export interface DetailMonetizationMetrics extends DetailAvailability {
  hasPremiumPayoutsLikely: boolean | null
  strategy: string
  gamePassCount: number
  developerProductCount: number
  totalMonetizationItemCount: number
  averageGamePassPrice: number | null
  averageDeveloperProductPrice: number | null
  gamePassCountVsGenreAverage: number | null
  averageGamePassPriceVsGenreAverage: number | null
}

export interface DetailComparableGame {
  universeId: number
  name: string
  genre: string
  similarityScore: number
  playing: number
  visits: number
  approval: number
  updated: string
  estimatedMonthlyRevenueUsd: DetailFinancialRange
}

export interface DetailComparables extends DetailAvailability {
  games: DetailComparableGame[]
}

export interface DetailDeveloperSummary extends DetailAvailability {
  estimatedPortfolioMonthlyRevenueUsd: DetailFinancialRange
  trackRecordScore: number | null
}

export interface DetailSocialDiscovery extends DetailAvailability {
  youtube: string | null
  tiktok: string | null
  x: string | null
  robloxSearchTrend: string | null
}

export interface GameDetailResponse {
  status: StatusSnapshot
  ops: OpsSnapshot
  game: {
    universeId: number
    rootPlaceId: number | null
    name: string
    description: string
    creatorName: string
    creatorId: number | null
    creatorType: string
    creatorHasVerifiedBadge: boolean
    rblxScore: number | null
    genre: string
    genrePrimary: string
    genreSecondary: string | null
    playing: number
    visits: number
    favoritedCount: number
    upVotes: number
    downVotes: number
    approval: number
    price: number | null
    maxPlayers: number | null
    created: string | null
    updated: string
    createVipServersAllowed: boolean
    thumbnailUrl?: string
    bannerUrl?: string
    seoImageUrl: string | null
    screenshotUrls: string[]
    tracked: boolean
  }
  timeline: TrendPoint[]
  eventFeed: EventRow[]
  stats: DetailStatRow[]
  keyIssues: DetailIssueRow[]
  dataSections: {
    pageMeta: DetailPageMeta
    ageRating: DetailAgeRating
    financials: DetailFinancialMetrics
    growth: DetailGrowthMetrics
    players: DetailPlayerMetrics
    monetization: DetailMonetizationMetrics
    comparables: DetailComparables
    developerSummary: DetailDeveloperSummary
    creatorProfile: DetailCreatorProfile
    creatorPortfolio: DetailCreatorPortfolio
    servers: DetailServerSample
    socialDiscovery: DetailSocialDiscovery
    store: {
      gamePasses: DetailStoreInventory
      developerProducts: DetailStoreInventory
    }
  }
  peers: WatchlistRow[]
}

export interface ScreenerQueryPlanStep {
  label: string
  value: string
}

export interface ScreenerResultRow {
  universeId: number
  name: string
  creatorName: string
  genre: string
  liveCCU: number
  approval: number
  visits: number
  favorites: number
  updated: string
  delta1h: number
  delta6h: number
  delta24h: number
  signal: string
  tone: Tone
  thumbnailUrl?: string
}

export interface ScreenerResponse {
  query: string
  status: StatusSnapshot
  ops: OpsSnapshot
  totalResults: number
  shownResults: number
  queryPlan: ScreenerQueryPlanStep[]
  tableCode: string
  summary: string
  results: ScreenerResultRow[]
}

export interface TabConfig {
  id: TabId
  label: string
  headline: string
  description: string
  savedQueries: string[]
  panelTitle: string
  panelBody: string
}

export interface StatusSnapshot {
  label: string
  detail: string
  tone: Tone
}

export interface LiveRobloxGame {
  universeId: number
  name: string
  creatorName: string
  creatorType: string
  genre: string
  playing: number
  visits: number
  favoritedCount: number
  approval: number
  updated: string
  thumbnailUrl?: string
  bannerUrl?: string
}

export interface LiveBoardResponse {
  status: StatusSnapshot
  ops: OpsSnapshot
  metrics: MetricCard[]
  leaderboard: LiveLeaderboardRow[]
  topFiveSeries: LiveTopSeriesRow[]
  topExperiences: TickerCard[]
  watchlist: WatchlistRow[]
  summaryFeed: SummaryItem[]
  trendingNow: TrendingItem[]
  timeline: TrendPoint[]
  eventFeed: EventRow[]
  genreHeatmap: HeatmapBucket[]
  updateCalendar: UpdateRow[]
  developerBoard: DeveloperRow[]
  alertQueue: AlertRow[]
}

export interface LivePlatformResponse {
  status: StatusSnapshot
  source: 'live' | 'cache'
  latest: LiveValuePoint
  peak: PlatformPeakPoint | null
  timeline: TrendPoint[]
  tone: Tone
}

export interface LiveLeaderboardRow {
  universeId: number
  name: string
  creatorName: string
  genre: string
  playing: number
  visits: number
  approval: number
  updated: string
  delta1h: number
  delta24h: number
  deltaWeek: number
  tone: Tone
  sparkline: number[]
  thumbnailUrl?: string
}

export interface LiveTopSeriesRow {
  universeId: number
  timeline: TrendPoint[]
}
