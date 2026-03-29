export type OverviewGameSnapshot = {
  rank?: number
  title: string
  subtitle: string
  primaryValue: string
  secondaryValue?: string
  deltaValue?: number
  tone?: 'positive' | 'negative' | 'neutral'
  trend?: number[]
  accentColor: string
}

export const livePlatformCcu = {
  value: '14.2M',
  tone: 'positive' as const,
  ranges: {
    '1D': [12.8, 12.9, 13.1, 13.0, 13.3, 13.4, 13.6, 13.7, 13.9, 14.2, 14.0, 14.1, 14.2],
    '1W': [11.6, 11.9, 12.1, 12.0, 12.3, 12.5, 12.8, 13.1, 13.4, 13.7, 13.9, 14.0, 14.2],
    '1M': [9.2, 9.5, 10.1, 10.4, 10.9, 11.2, 11.6, 12.0, 12.4, 12.9, 13.3, 13.8, 14.2],
  },
}

export const liveRevenueEstimate = {
  value: '$8.6M',
  tone: 'neutral' as const,
  ranges: {
    '1D': [6.2, 6.4, 6.1, 6.8, 7.0, 7.4, 7.1, 7.3, 7.6, 7.8, 8.1, 8.0, 8.6],
    '1W': [5.6, 5.8, 6.0, 6.2, 6.5, 6.4, 6.8, 7.1, 7.3, 7.6, 8.0, 8.2, 8.6],
    '1M': [4.4, 4.8, 5.1, 5.6, 5.9, 6.2, 6.7, 7.0, 7.2, 7.6, 7.9, 8.2, 8.6],
  },
  labels: {
    '1D': ['12 AM', '2 AM', '4 AM', '6 AM', '8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM', '10 PM', 'Now'],
    '1W': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    '1M': ['Week 1', 'W1', 'W1', 'Week 2', 'W2', 'W2', 'Week 3', 'W3', 'W3', 'Week 4', 'W4', 'W4', 'Now'],
  },
}

export const topGamesByCcu: OverviewGameSnapshot[] = [
  {
    rank: 1,
    title: 'Grow a Garden',
    subtitle: 'The Garden Game',
    primaryValue: '1.92M',
    secondaryValue: '$412K/day',
    tone: 'positive',
    trend: [78, 80, 79, 82, 84, 85, 87, 86, 89, 92],
    accentColor: '#6ECF7C',
  },
  {
    rank: 2,
    title: 'Brookhaven RP',
    subtitle: 'Wolfpaq',
    primaryValue: '612K',
    secondaryValue: '$131K/day',
    tone: 'negative',
    trend: [72, 71, 70, 70, 69, 68, 68, 67, 66, 65],
    accentColor: '#5A8BFF',
  },
  {
    rank: 3,
    title: 'Blox Fruits',
    subtitle: 'Gamer Robot',
    primaryValue: '488K',
    secondaryValue: '$164K/day',
    tone: 'positive',
    trend: [61, 62, 61, 63, 64, 64, 65, 66, 68, 70],
    accentColor: '#F0B90B',
  },
  {
    rank: 4,
    title: 'Adopt Me!',
    subtitle: 'Uplift Games',
    primaryValue: '356K',
    secondaryValue: '$118K/day',
    tone: 'negative',
    trend: [58, 59, 59, 57, 56, 56, 55, 55, 54, 53],
    accentColor: '#FF9FCF',
  },
  {
    rank: 5,
    title: 'Blue Lock: Rivals',
    subtitle: 'Untitled',
    primaryValue: '244K',
    secondaryValue: '$91K/day',
    tone: 'positive',
    trend: [40, 41, 43, 45, 46, 49, 53, 56, 60, 65],
    accentColor: '#43C7FF',
  },
  {
    rank: 6,
    title: 'Forsaken',
    subtitle: 'Forsaken',
    primaryValue: '190K',
    secondaryValue: '$58K/day',
    tone: 'positive',
    trend: [34, 34, 35, 36, 38, 39, 40, 42, 43, 46],
    accentColor: '#B793FF',
  },
  {
    rank: 7,
    title: 'Murder Mystery 2',
    subtitle: 'Nikilis',
    primaryValue: '178K',
    secondaryValue: '$46K/day',
    tone: 'negative',
    trend: [48, 47, 47, 46, 46, 45, 45, 44, 44, 43],
    accentColor: '#FF725C',
  },
  {
    rank: 8,
    title: 'Dress To Impress',
    subtitle: 'Gigi',
    primaryValue: '164K',
    secondaryValue: '$51K/day',
    tone: 'positive',
    trend: [36, 36, 37, 38, 38, 39, 40, 41, 42, 43],
    accentColor: '#FF59C9',
  },
  {
    rank: 9,
    title: 'Arise Crossover',
    subtitle: 'CL GAMES!',
    primaryValue: '151K',
    secondaryValue: '$39K/day',
    tone: 'positive',
    trend: [30, 31, 31, 32, 33, 34, 35, 36, 38, 39],
    accentColor: '#8EE3A2',
  },
  {
    rank: 10,
    title: 'Anime Vanguards',
    subtitle: 'Kitawari',
    primaryValue: '139K',
    secondaryValue: '$36K/day',
    tone: 'negative',
    trend: [42, 41, 40, 39, 40, 39, 38, 38, 37, 36],
    accentColor: '#F59E7A',
  },
]

export const trendingGames: OverviewGameSnapshot[] = [
  {
    title: 'Blue Lock: Rivals',
    subtitle: 'Untitled',
    primaryValue: '244K',
    deltaValue: 8.92,
    tone: 'positive',
    trend: [40, 41, 43, 45, 46, 49, 53, 56, 60, 65],
    accentColor: '#43C7FF',
  },
  {
    title: 'Forsaken',
    subtitle: 'Forsaken',
    primaryValue: '190K',
    deltaValue: 5.36,
    tone: 'positive',
    trend: [34, 34, 35, 36, 38, 39, 40, 42, 43, 46],
    accentColor: '#B793FF',
  },
  {
    title: 'Grow a Garden',
    subtitle: 'The Garden Game',
    primaryValue: '1.92M',
    deltaValue: 4.21,
    tone: 'positive',
    trend: [78, 80, 79, 82, 84, 85, 87, 86, 89, 92],
    accentColor: '#6ECF7C',
  },
  {
    title: 'Dress To Impress',
    subtitle: 'Gigi',
    primaryValue: '164K',
    deltaValue: 3.04,
    tone: 'positive',
    trend: [36, 36, 37, 38, 38, 39, 40, 41, 42, 43],
    accentColor: '#FF59C9',
  },
]

export const topGainers: OverviewGameSnapshot[] = [
  {
    title: 'Blue Lock: Rivals',
    subtitle: 'Untitled',
    primaryValue: '244K',
    deltaValue: 8.92,
    tone: 'positive',
    trend: [40, 41, 43, 45, 46, 49, 53, 56, 60, 65],
    accentColor: '#43C7FF',
  },
  {
    title: 'Forsaken',
    subtitle: 'Forsaken',
    primaryValue: '190K',
    deltaValue: 5.36,
    tone: 'positive',
    trend: [34, 34, 35, 36, 38, 39, 40, 42, 43, 46],
    accentColor: '#B793FF',
  },
  {
    title: 'Grow a Garden',
    subtitle: 'The Garden Game',
    primaryValue: '1.92M',
    deltaValue: 4.21,
    tone: 'positive',
    trend: [78, 80, 79, 82, 84, 85, 87, 86, 89, 92],
    accentColor: '#6ECF7C',
  },
]

export const topLosers: OverviewGameSnapshot[] = [
  {
    title: 'Adopt Me!',
    subtitle: 'Uplift Games',
    primaryValue: '356K',
    deltaValue: -2.11,
    tone: 'negative',
    trend: [58, 59, 59, 57, 56, 56, 55, 55, 54, 53],
    accentColor: '#FF9FCF',
  },
  {
    title: 'Brookhaven RP',
    subtitle: 'Wolfpaq',
    primaryValue: '612K',
    deltaValue: -1.83,
    tone: 'negative',
    trend: [72, 71, 70, 70, 69, 68, 68, 67, 66, 65],
    accentColor: '#5A8BFF',
  },
  {
    title: 'Anime Vanguards',
    subtitle: 'Kitawari',
    primaryValue: '139K',
    deltaValue: -1.14,
    tone: 'negative',
    trend: [42, 41, 40, 39, 40, 39, 38, 38, 37, 36],
    accentColor: '#F59E7A',
  },
]

export const newBreakouts: OverviewGameSnapshot[] = [
  {
    title: 'Blue Lock: Rivals',
    subtitle: 'Untitled',
    primaryValue: '244K',
    secondaryValue: '12 days',
    deltaValue: 8.92,
    tone: 'positive',
    trend: [40, 41, 43, 45, 46, 49, 53, 56, 60, 65],
    accentColor: '#43C7FF',
  },
  {
    title: 'Forsaken',
    subtitle: 'Forsaken',
    primaryValue: '190K',
    secondaryValue: '27 days',
    deltaValue: 5.36,
    tone: 'positive',
    trend: [34, 34, 35, 36, 38, 39, 40, 42, 43, 46],
    accentColor: '#B793FF',
  },
  {
    title: 'Arise Crossover',
    subtitle: 'CL GAMES!',
    primaryValue: '151K',
    secondaryValue: '19 days',
    deltaValue: 4.6,
    tone: 'positive',
    trend: [30, 31, 31, 32, 33, 34, 35, 36, 38, 39],
    accentColor: '#8EE3A2',
  },
]
