import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import {
  ChevronDown,
  Eye,
  Plus,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { CategoryPerformanceMap } from '../components/market-ui/CategoryPerformanceMap'
import { Breadcrumbs as MarketBreadcrumbs } from '../components/market-ui/Breadcrumbs'
import { GamesOverviewTable } from '../components/market-ui/GamesOverviewTable'
import { InfoTooltip } from '../components/market-ui/InfoTooltip'
import { LiveMetricHero } from '../components/market-ui/LiveMetricHero'
import { MarketButton } from '../components/market-ui/MarketButton'
import { MiniTrendChart } from '../components/market-ui/MiniTrendChart'
import { RevenueEstimateHero } from '../components/market-ui/RevenueEstimateHero'
import { SegmentedControl as MarketSegmentedControl } from '../components/market-ui/SegmentedControl'
import { SectionBlock as MarketSectionBlock } from '../components/market-ui/SectionBlock'
import { SurfacePanel } from '../components/market-ui/SurfacePanel'
import { ToolbarIconButton } from '../components/market-ui/ToolbarIconButton'
import { ToolbarSelect } from '../components/market-ui/ToolbarSelect'
import {
  livePlatformCcu,
  topGamesByCcu,
  trendingGames,
} from '../data/homeOverview'
import { NETWORKS, TIME_PERIODS, TOKENS, TYPOGRAPHY_SPECS } from '../design/marketTokens'

type Token = {
  rank: number
  name: string
  symbol: string
  price: number
  change1h: number
  change1d: number
  fdv: number
  volume: number
  sparkline: number[]
  color: string
  priceLabel?: string
  fdvLabel?: string
  volumeLabel?: string
  badgeColor?: string
  highlight?: boolean
}

type SortField = 'fdv' | 'price' | 'change1h' | 'change1d' | 'volume'
type SortDirection = 'asc' | 'desc'

const MOCK_TOKENS: Token[] = [
  {
    rank: 1,
    name: 'USD Coin',
    symbol: 'USDC',
    price: 1,
    change1h: 0,
    change1d: 0,
    fdv: 78000000000,
    volume: 566800000,
    sparkline: [1, 1.02, 0.98, 1, 1, 1, 1, 1, 1],
    color: '#2775CA',
    priceLabel: '$1.00',
    fdvLabel: '$78.0B',
    volumeLabel: '$566.8M',
  },
  {
    rank: 2,
    name: 'Tether USD',
    symbol: 'USDT',
    price: 1,
    change1h: 0,
    change1d: 0,
    fdv: 189600000000,
    volume: 464900000,
    sparkline: [1, 1.01, 0.99, 1, 1, 1, 1, 1, 1],
    color: '#50AF95',
    priceLabel: '$1.00',
    fdvLabel: '$189.6B',
    volumeLabel: '$464.9M',
  },
  {
    rank: 3,
    name: 'Tether USD',
    symbol: 'USDT',
    price: 1,
    change1h: 0,
    change1d: 0,
    fdv: 189600000000,
    volume: 425800000,
    sparkline: [1, 1, 1, 1, 0.96, 1.04, 1, 1, 1],
    color: '#50AF95',
    priceLabel: '$1.00',
    fdvLabel: '$189.6B',
    volumeLabel: '$425.8M',
    badgeColor: '#F0B90B',
  },
  {
    rank: 4,
    name: 'Ethereum',
    symbol: 'ETH',
    price: 2069.91,
    change1h: 0.2,
    change1d: -3.79,
    fdv: 254500000000,
    volume: 399000000,
    sparkline: [2100, 2096, 2102, 2098, 2108, 2112, 2109, 2104, 2107, 2108],
    color: '#627EEA',
    priceLabel: '$2,069.91',
    fdvLabel: '$254.5B',
    volumeLabel: '$399.0M',
    highlight: true,
  },
  {
    rank: 5,
    name: 'Quq',
    symbol: 'QUQ',
    price: 0.00212,
    change1h: 0,
    change1d: 0,
    fdv: 2100000,
    volume: 298500000,
    sparkline: [0.0018, 0.0018, 0.0018, 0.0018, 0.0018, 0.0018, 0.00182, 0.00181, 0.00212],
    color: '#BFC4D3',
    priceLabel: '$0.00212',
    fdvLabel: '$2.1M',
    volumeLabel: '$298.5M',
    badgeColor: '#F0B90B',
  },
  {
    rank: 6,
    name: 'Base ETH',
    symbol: 'ETH',
    price: 2068.42,
    change1h: -0.02,
    change1d: -3.73,
    fdv: 198200000,
    volume: 130200000,
    sparkline: [2101, 2097, 2100, 2098, 2105, 2110, 2108, 2103, 2106, 2107],
    color: '#627EEA',
    priceLabel: '$2,068.42',
    fdvLabel: '$198.2M',
    volumeLabel: '$130.2M',
    badgeColor: '#0052FF',
  },
  {
    rank: 7,
    name: 'USD Coin',
    symbol: 'USDC',
    price: 0.998,
    change1h: 0.23,
    change1d: -0.06,
    fdv: 78000000000,
    volume: 123600000,
    sparkline: [1.01, 0.99, 1.005, 0.992, 1.002, 0.989, 1.004, 0.996, 0.998],
    color: '#2775CA',
    priceLabel: '$0.998',
    fdvLabel: '$78.0B',
    volumeLabel: '$123.6M',
    badgeColor: '#223D59',
  },
  {
    rank: 8,
    name: 'Solana',
    symbol: 'SOL',
    price: 86.9,
    change1h: -0.06,
    change1d: -4.68,
    fdv: 52600000000,
    volume: 105800000,
    sparkline: [89.1, 88.8, 89, 88.7, 88.9, 88.6, 88.7, 88.8, 88.75, 88.7],
    color: '#14F195',
    priceLabel: '$86.90',
    fdvLabel: '$52.6B',
    volumeLabel: '$105.8M',
  },
]

function formatPrice(price: number) {
  if (price >= 1000) {
    return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (price >= 1) return '$' + price.toFixed(2)
  if (price >= 0.01) return '$' + price.toFixed(4)
  return '$' + price.toFixed(8)
}

function formatCompact(value: number) {
  if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B'
  if (value >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M'
  if (value >= 1e3) return '$' + (value / 1e3).toFixed(2) + 'K'
  return '$' + value.toFixed(2)
}

function TokenLogo({ symbol, color, size = 32 }: { symbol: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: TOKENS.radii.round,
        background: `linear-gradient(135deg, ${color}44, ${color})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.375,
        fontWeight: 600,
        color: TOKENS.colors.neutral1,
        flexShrink: 0,
      }}
    >
      {symbol.slice(0, 2)}
    </div>
  )
}

function DeltaValue({ value }: { value: number }) {
  const tone =
    value > 0
      ? TOKENS.colors.success
      : value < 0
        ? TOKENS.colors.critical
        : TOKENS.colors.neutral3

  const rotation = value < 0 ? '180deg' : '0deg'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        color: TOKENS.colors.neutral1,
        fontWeight: 500,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ color: tone, transform: `rotate(${rotation})` }}>
        <path d="M6 2 11 10H1L6 2Z" fill="currentColor" />
      </svg>
      <span>{Math.abs(value).toFixed(2)}%</span>
    </span>
  )
}

function Surface({
  children,
  padding = TOKENS.spacing.lg,
}: {
  children: ReactNode
  padding?: string
}) {
  return (
    <div
      style={{
        background: TOKENS.colors.surface2,
        border: `1px solid ${TOKENS.colors.neutral4}33`,
        borderRadius: TOKENS.radii.xl,
        padding,
        boxShadow: TOKENS.shadows.card,
      }}
    >
      {children}
    </div>
  )
}

function NetworkChip({
  label,
  icon,
  color,
  active = false,
  onClick,
}: {
  label: string
  icon: string
  color: string
  active?: boolean
  onClick?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: TOKENS.spacing.xs,
        padding: '8px 12px',
        borderRadius: TOKENS.radii.pill,
        border: `1px solid ${hovered || active ? `${TOKENS.colors.neutral4}AA` : `${TOKENS.colors.neutral4}55`}`,
        background: active ? TOKENS.colors.surface3 : hovered ? TOKENS.colors.surface4 : TOKENS.colors.surface2,
        color: active || hovered ? TOKENS.colors.neutral1 : TOKENS.colors.neutral2,
        fontSize: TOKENS.typography.body2.size,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: `background ${TOKENS.transitions.fast}, border-color ${TOKENS.transitions.fast}, color ${TOKENS.transitions.fast}`,
      }}
    >
      <span style={{ color, fontSize: '10px' }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: TOKENS.spacing.xs,
        padding: '12px 14px',
        background: hovered || focused ? TOKENS.colors.surface3 : TOKENS.colors.surface2,
        borderRadius: TOKENS.radii.xl,
        border: `1px solid ${focused ? `${TOKENS.colors.accent1}66` : hovered ? `${TOKENS.colors.neutral4}AA` : `${TOKENS.colors.neutral4}55`}`,
        transition: `background ${TOKENS.transitions.fast}, border-color ${TOKENS.transitions.fast}`,
      }}
    >
      <Search size={16} color={TOKENS.colors.neutral2} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: TOKENS.colors.neutral1,
          fontSize: TOKENS.typography.body1.size,
          fontFamily: 'inherit',
        }}
      />
      <kbd
        style={{
          borderRadius: '6px',
          padding: '2px 6px',
          border: `1px solid ${TOKENS.colors.neutral4}`,
          background: TOKENS.colors.surface3,
          color: TOKENS.colors.neutral2,
          fontSize: '11px',
        }}
      >
        /
      </kbd>
    </div>
  )
}

function SegmentedControl({
  options,
  value,
  onChange,
  align = 'left',
}: {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
  align?: 'left' | 'right'
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: '4px',
        background: 'transparent',
        borderRadius: TOKENS.radii.pill,
        border: `1px solid ${TOKENS.colors.neutral4}66`,
        gap: '4px',
        justifySelf: align,
      }}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          onMouseEnter={() => setHovered(option)}
          onMouseLeave={() => setHovered(null)}
          style={{
            background:
              value === option
                ? TOKENS.colors.surface4
                : hovered === option
                  ? TOKENS.colors.surface2
                  : 'transparent',
            color:
              value === option || hovered === option
                ? TOKENS.colors.neutral1
                : TOKENS.colors.neutral2,
            border: 'none',
            borderRadius: TOKENS.radii.pill,
            minHeight: '40px',
            padding: '0 16px',
            cursor: 'pointer',
            fontSize: TOKENS.typography.body3.size,
            fontWeight: 600,
            fontFamily: 'inherit',
            transition: `background ${TOKENS.transitions.fast}, color ${TOKENS.transitions.fast}`,
          }}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function UnderlineTabs({
  options,
  value,
  onChange,
}: {
  options: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div
      style={{
        display: 'flex',
        gap: TOKENS.spacing.lg,
      }}
    >
      {options.map((option) => {
        const active = value === option

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            onMouseEnter={() => setHovered(option)}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '0 0 8px',
              border: 'none',
              background: 'transparent',
              color:
                active || hovered === option
                  ? TOKENS.colors.neutral1
                  : TOKENS.colors.neutral2,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: TOKENS.typography.body1.size,
              fontWeight: 500,
              transition: `color ${TOKENS.transitions.fast}`,
            }}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function WalletIdentityHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: TOKENS.spacing.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: TOKENS.spacing.md }}>
        <div
          style={{
            width: '30px',
            height: '30px',
            borderRadius: TOKENS.radii.round,
            background: '#2A1626',
            color: TOKENS.colors.accent1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            fontWeight: 700,
          }}
        >
          ✣
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '19px', fontWeight: 500 }}>Demo wallet</span>
          <Eye size={16} color={TOKENS.colors.neutral2} />
        </div>
      </div>
    </div>
  )
}

function NetworkFilterPill() {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        minHeight: '44px',
        padding: '0 16px',
        borderRadius: TOKENS.radii.lg,
        border: `1px solid ${hovered ? `${TOKENS.colors.neutral4}AA` : `${TOKENS.colors.neutral4}66`}`,
        background: hovered ? TOKENS.colors.surface2 : 'transparent',
        color: TOKENS.colors.neutral1,
        fontFamily: 'inherit',
        fontSize: TOKENS.typography.body2.size,
        fontWeight: 600,
        cursor: 'pointer',
        transition: `background ${TOKENS.transitions.fast}, border-color ${TOKENS.transitions.fast}`,
      }}
    >
      <span style={{ position: 'relative', width: '18px', height: '18px', display: 'inline-block' }}>
        <span style={{ position: 'absolute', top: 0, left: 0, width: '8px', height: '8px', borderRadius: '999px', background: '#D7D9E0' }} />
        <span style={{ position: 'absolute', top: 0, right: 0, width: '8px', height: '8px', borderRadius: '999px', background: TOKENS.colors.accent1 }} />
        <span style={{ position: 'absolute', bottom: 0, left: 0, width: '8px', height: '8px', borderRadius: '999px', background: TOKENS.colors.base }} />
        <span style={{ position: 'absolute', bottom: 0, right: 0, width: '8px', height: '8px', borderRadius: '999px', background: TOKENS.colors.critical }} />
      </span>
      <span>All networks</span>
      <ChevronDown size={18} />
    </button>
  )
}


function StatusPill({
  tone,
  children,
}: {
  tone: 'positive' | 'negative' | 'neutral' | 'accent'
  children: ReactNode
}) {
  const palette = {
    positive: {
      background: `${TOKENS.colors.success}1A`,
      color: TOKENS.colors.success,
    },
    negative: {
      background: `${TOKENS.colors.critical}1A`,
      color: TOKENS.colors.critical,
    },
    neutral: {
      background: TOKENS.colors.surface3,
      color: TOKENS.colors.neutral2,
    },
    accent: {
      background: `${TOKENS.colors.accent1}1A`,
      color: TOKENS.colors.accent1,
    },
  }[tone]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: TOKENS.radii.pill,
        background: palette.background,
        color: palette.color,
        fontSize: TOKENS.typography.body3.size,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  )
}

function MarketStatStrip({ tokens }: { tokens: Token[] }) {
  const metrics = [
    { label: 'Volume', value: '$3.74B', change: '2.56% today', tone: 'positive' as const },
    { label: 'TVL', value: '$4.28B', change: '1.12% today', tone: 'negative' as const },
    { label: 'v3 TVL', value: '$1.02B', change: '11.00% today', tone: 'negative' as const },
    { label: 'v4 TVL', value: '$562.96M', change: '9.06% today', tone: 'negative' as const },
  ]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
      }}
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          style={{
            padding: '0 24px 0 0',
            marginLeft: index === 0 ? 0 : '24px',
            borderLeft: index === 0 ? 'none' : `1px solid ${TOKENS.colors.neutral4}33`,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minHeight: '92px',
          }}
        >
          <span style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body3.size }}>{metric.label}</span>
          <strong style={{ fontSize: '18px', lineHeight: '24px', fontWeight: 500 }}>{metric.value}</strong>
          <span
            style={{
              color: metric.tone === 'positive' ? TOKENS.colors.success : TOKENS.colors.critical,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: TOKENS.typography.body3.size,
              fontWeight: 600,
            }}
          >
            {metric.tone === 'positive' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {metric.change}
          </span>
        </div>
      ))}
      <div style={{ display: 'none' }}>{tokens.length}</div>
    </div>
  )
}

function HeaderCell({
  label,
  field,
  sortBy,
  onSort,
}: {
  label: string
  field: SortField
  sortBy: SortField
  onSort: (field: SortField) => void
}) {
  const active = sortBy === field

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        border: 'none',
        background: 'transparent',
        color: active ? TOKENS.colors.neutral1 : TOKENS.colors.neutral2,
        cursor: 'pointer',
        padding: 0,
        font: 'inherit',
        fontSize: TOKENS.typography.body3.size,
        fontWeight: 500,
      }}
    >
      {active ? <span style={{ fontSize: '14px', lineHeight: 1 }}>{'↓'}</span> : null}
      {label}
    </button>
  )
}

function TokenTable({
  rows,
  sortBy,
  onSort,
  hoveredRow,
  setHoveredRow,
}: {
  rows: Token[]
  sortBy: SortField
  onSort: (field: SortField) => void
  hoveredRow: number | null
  setHoveredRow: (value: number | null) => void
}) {
  return (
    <Surface padding="0">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '74px 2.5fr 1.1fr 1fr 1fr 1.15fr 1.15fr 148px',
          padding: '18px 28px',
          borderBottom: `1px solid ${TOKENS.colors.neutral4}33`,
          color: TOKENS.colors.neutral2,
          fontSize: TOKENS.typography.body2.size,
          fontWeight: 500,
        }}
      >
        <span>#</span>
        <span>Token name</span>
        <HeaderCell label="Price" field="price" sortBy={sortBy} onSort={onSort} />
        <HeaderCell label="1H" field="change1h" sortBy={sortBy} onSort={onSort} />
        <HeaderCell label="1D" field="change1d" sortBy={sortBy} onSort={onSort} />
        <HeaderCell label="FDV" field="fdv" sortBy={sortBy} onSort={onSort} />
        <HeaderCell label="Volume" field="volume" sortBy={sortBy} onSort={onSort} />
        <span style={{ textAlign: 'right' }}>1D chart</span>
      </div>

      <div style={{ display: 'grid', gap: '8px', padding: '10px' }}>
        {rows.map((token) => {
          const positive = token.change1d >= 0
          const rowActive = hoveredRow === token.rank || token.highlight

          return (
            <div
              key={`${token.rank}-${token.name}-${token.symbol}`}
              onMouseEnter={() => setHoveredRow(token.rank)}
              onMouseLeave={() => setHoveredRow(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: '74px 2.5fr 1.1fr 1fr 1fr 1.15fr 1.15fr 148px',
                alignItems: 'center',
                minHeight: '80px',
                padding: '0 22px',
                borderRadius: '28px',
                background: rowActive ? '#1A1A1A' : 'transparent',
              }}
            >
              <span style={{ color: TOKENS.colors.neutral1, fontSize: TOKENS.typography.body1.size, fontWeight: 500 }}>{token.rank}</span>

              <div style={{ display: 'flex', alignItems: 'center', gap: TOKENS.spacing.md, minWidth: 0 }}>
                <div style={{ position: 'relative', width: '44px', height: '44px', flexShrink: 0 }}>
                  <TokenLogo symbol={token.symbol} color={token.color} size={44} />
                  {token.badgeColor ? (
                    <span
                      style={{
                        position: 'absolute',
                        right: '-2px',
                        bottom: '-2px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '6px',
                        background: token.badgeColor,
                        border: `2px solid ${TOKENS.colors.surface1}`,
                      }}
                    />
                  ) : null}
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', minWidth: 0 }}>
                  <span style={{ fontSize: TOKENS.typography.body1.size, fontWeight: 500, whiteSpace: 'nowrap' }}>{token.name}</span>
                  <span style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body1.size, whiteSpace: 'nowrap' }}>{token.symbol}</span>
                </div>
              </div>

              <span style={{ fontSize: TOKENS.typography.body1.size, fontWeight: 500 }}>{token.priceLabel ?? formatPrice(token.price)}</span>
              <DeltaValue value={token.change1h} />
              <DeltaValue value={token.change1d} />
              <span style={{ fontSize: TOKENS.typography.body1.size, fontWeight: 500 }}>{token.fdvLabel ?? formatCompact(token.fdv)}</span>
              <span style={{ fontSize: TOKENS.typography.body1.size, fontWeight: 500 }}>{token.volumeLabel ?? formatCompact(token.volume)}</span>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <MiniTrendChart
                  points={token.sparkline}
                  tone={positive ? 'positive' : 'negative'}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Surface>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: TOKENS.spacing.lg }}>
      <div>
        <h2
          style={{
            fontSize: TOKENS.typography.heading1.size,
            fontWeight: TOKENS.typography.heading1.weight,
            letterSpacing: TOKENS.typography.heading1.letterSpacing,
            marginBottom: '8px',
          }}
        >
          {title}
        </h2>
        <p style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body1.size }}>{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

function SubSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: TOKENS.spacing.md }}>
      <div style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body2.size, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  )
}

function ColorSwatch({
  name,
  value,
  border = false,
}: {
  name: string
  value: string
  border?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div
        style={{
          width: '100%',
          minHeight: '88px',
          borderRadius: TOKENS.radii.lg,
          background: value,
          border: border ? `1px solid ${TOKENS.colors.neutral4}` : 'none',
        }}
      />
      <div>
        <div style={{ fontSize: TOKENS.typography.body2.size, fontWeight: 600 }}>{name}</div>
        <div style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body3.size }}>{value}</div>
      </div>
    </div>
  )
}

export default function UniswapDesignSystem() {
  const [query, setQuery] = useState('')
  const [activeNetwork, setActiveNetwork] = useState('Ethereum')
  const [timePeriod, setTimePeriod] = useState<(typeof TIME_PERIODS)[number]>('1D')
  const [walletTab, setWalletTab] = useState('Overview')
  const [sortBy, setSortBy] = useState<SortField>('volume')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const filteredTokens = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    return MOCK_TOKENS.filter((token) => {
      if (!normalized) return true
      return (
        token.name.toLowerCase().includes(normalized) ||
        token.symbol.toLowerCase().includes(normalized)
      )
    })
  }, [query])

  const sortedTokens = useMemo(() => {
    const direction = sortDir === 'desc' ? -1 : 1
    const next = [...filteredTokens]

    next.sort((a, b) => {
      if (sortBy === 'price') return direction * (a.price - b.price)
      if (sortBy === 'change1h') return direction * (a.change1h - b.change1h)
      if (sortBy === 'change1d') return direction * (a.change1d - b.change1d)
      if (sortBy === 'volume') return direction * (a.volume - b.volume)
      return direction * (a.fdv - b.fdv)
    })

    return next
  }, [filteredTokens, sortBy, sortDir])

  const catalogGameRows = useMemo(
    () =>
      topGamesByCcu.slice(0, 4).map((item, index) => ({
        rank: item.rank ?? index + 1,
        name: item.title,
        studio: item.subtitle,
        playersLabel: item.primaryValue,
        change1h: index % 2 === 0 ? 1.24 - index * 0.18 : -0.42 - index * 0.22,
        change24h: item.tone === 'positive' ? 3.8 - index * 0.4 : -2.1 - index * 0.3,
        ratingLabel: `${92 - index}%`,
        visitsLabel: `${(1.2 - index * 0.11).toFixed(2)}B`,
        chartTone: item.tone === 'negative' ? ('negative' as const) : ('positive' as const),
        trend: item.trend ?? [],
        accentColor: item.accentColor,
      })),
    [],
  )

  const catalogCategorySections = useMemo(
    () => [
      {
        id: 'roleplay',
        title: 'Roleplay',
        span: 6 as const,
        items: [
          {
            id: 'brookhaven',
            title: 'Brookhaven RP',
            value: '+12.4%',
            subtitle: '788K CCU',
            change: 12.4,
            weight: 788000,
            tone: 'positive' as const,
            span: 'hero' as const,
          },
          {
            id: 'adopt-me',
            title: 'Adopt Me!',
            value: '+4.1%',
            subtitle: '531K CCU',
            change: 4.1,
            weight: 531000,
            tone: 'positive' as const,
            span: 'feature' as const,
          },
          {
            id: 'dress',
            title: 'Dress To Impress',
            value: '-2.2%',
            change: -2.2,
            weight: 164000,
            tone: 'negative' as const,
            span: 'standard' as const,
          },
          {
            id: 'berry',
            title: 'Berry Avenue',
            value: '+1.9%',
            change: 1.9,
            weight: 143000,
            tone: 'positive' as const,
            span: 'standard' as const,
          },
          {
            id: 'pls',
            title: 'PLS DONATE',
            value: '+0.8%',
            change: 0.8,
            weight: 62000,
            tone: 'neutral' as const,
            span: 'compact' as const,
          },
        ],
      },
      {
        id: 'sim',
        title: 'Simulation',
        span: 6 as const,
        items: [
          {
            id: 'garden',
            title: 'Grow a Garden',
            value: '+18.2%',
            subtitle: '1.9M CCU',
            change: 18.2,
            weight: 1920000,
            tone: 'positive' as const,
            span: 'hero' as const,
          },
          {
            id: 'brainrot',
            title: 'Steal a Brainrot',
            value: '+8.6%',
            change: 8.6,
            weight: 431000,
            tone: 'positive' as const,
            span: 'feature' as const,
          },
          {
            id: 'pet',
            title: 'Pet Sim 99',
            value: '-4.1%',
            change: -4.1,
            weight: 118000,
            tone: 'negative' as const,
            span: 'standard' as const,
          },
          {
            id: 'fisch',
            title: 'Fisch',
            value: '+3.3%',
            change: 3.3,
            weight: 77000,
            tone: 'positive' as const,
            span: 'compact' as const,
          },
        ],
      },
    ],
    [],
  )

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'))
      return
    }

    setSortBy(field)
    setSortDir('desc')
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: TOKENS.colors.surface1,
        color: TOKENS.colors.neutral1,
        fontFamily: TOKENS.typography.fontFamily,
        fontSize: TOKENS.typography.body1.size,
        lineHeight: TOKENS.typography.body1.lineHeight,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::selection { background: ${TOKENS.colors.accent1}33; }
      `}</style>

      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 16px 80px' }}>
        <div style={{ display: 'grid', gap: TOKENS.spacing.xl }}>
          <Section
            title="Foundations"
            subtitle="The shared constants that the higher-level components should bind to."
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: TOKENS.spacing.lg }}>
              <SubSection title="Colors">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: TOKENS.spacing.md }}>
                  <ColorSwatch name="accent1" value={TOKENS.colors.accent1} />
                  <ColorSwatch name="surface1" value={TOKENS.colors.surface1} border />
                  <ColorSwatch name="surface2" value={TOKENS.colors.surface2} border />
                  <ColorSwatch name="neutral1" value={TOKENS.colors.neutral1} border />
                  <ColorSwatch name="success" value={TOKENS.colors.success} />
                  <ColorSwatch name="critical" value={TOKENS.colors.critical} />
                </div>
              </SubSection>

              <SubSection title="Spacing + radii">
                <div style={{ display: 'grid', gap: TOKENS.spacing.md }}>
                  {Object.entries(TOKENS.spacing).map(([name, value]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: TOKENS.spacing.md }}>
                      <span style={{ width: '44px', color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body3.size }}>
                        {name}
                      </span>
                      <div
                        style={{
                          width: value,
                          height: '16px',
                          borderRadius: '999px',
                          background: `linear-gradient(90deg, ${TOKENS.colors.accent1}88, ${TOKENS.colors.accent1})`,
                        }}
                      />
                      <span style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body3.size }}>{value}</span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: TOKENS.spacing.lg,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: TOKENS.spacing.sm,
                  }}
                >
                  {Object.entries(TOKENS.radii).map(([name, value]) => (
                    <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div
                        style={{
                          minHeight: '56px',
                          background: TOKENS.colors.surface3,
                          borderRadius: value,
                          border: `1px solid ${TOKENS.colors.neutral4}33`,
                        }}
                      />
                      <span style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body3.size }}>{name}</span>
                    </div>
                  ))}
                </div>
              </SubSection>
            </div>

            <SubSection title="Typography">
              <div style={{ display: 'grid', gap: '12px' }}>
                {TYPOGRAPHY_SPECS.map(([name, spec]) => (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: TOKENS.spacing.md,
                      paddingBottom: '12px',
                      borderBottom: `1px solid ${TOKENS.colors.neutral4}22`,
                    }}
                  >
                    <span
                      style={{
                        fontSize: spec.size,
                        fontWeight: spec.weight,
                        lineHeight: spec.lineHeight,
                        letterSpacing: spec.letterSpacing,
                      }}
                    >
                      {name}
                    </span>
                    <span style={{ color: TOKENS.colors.neutral2, fontSize: TOKENS.typography.body3.size }}>
                      {spec.size} / {spec.weight} / {spec.lineHeight}
                    </span>
                  </div>
                ))}
              </div>
            </SubSection>
          </Section>

          <Section
            title="Controls"
            subtitle="Single-purpose interaction primitives."
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TOKENS.spacing.lg }}>
              <SubSection title="Buttons">
                <div style={{ display: 'flex', gap: TOKENS.spacing.sm, flexWrap: 'wrap' }}>
                  <MarketButton leadingIcon={<RefreshCw size={20} strokeWidth={2.5} />}>
                    Primary
                  </MarketButton>
                  <MarketButton
                    variant="secondary"
                    leadingIcon={<Plus size={20} strokeWidth={2.5} />}
                  >
                    Secondary
                  </MarketButton>
                  <MarketButton variant="tertiary" leadingIcon={<Eye size={20} strokeWidth={2.5} />}>
                    Tertiary
                  </MarketButton>
                  <MarketButton
                    variant="outline"
                    leadingIcon={<ChevronDown size={20} strokeWidth={2.5} />}
                  >
                    Outline
                  </MarketButton>
                </div>
              </SubSection>

              <SubSection title="Search field">
                <SearchField value={query} onChange={setQuery} placeholder="Search components" />
              </SubSection>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TOKENS.spacing.lg }}>
              <SubSection title="Segmented control">
                <SegmentedControl options={TIME_PERIODS} value={timePeriod} onChange={(value) => setTimePeriod(value as (typeof TIME_PERIODS)[number])} />
              </SubSection>

              <SubSection title="Network chips">
                <div style={{ display: 'flex', gap: TOKENS.spacing.sm, flexWrap: 'wrap' }}>
                  {NETWORKS.map((network) => (
                    <NetworkChip
                      key={network.name}
                      label={network.name}
                      icon={network.icon}
                      color={network.color}
                      active={activeNetwork === network.name}
                      onClick={() => setActiveNetwork(network.name)}
                    />
                  ))}
                </div>
              </SubSection>

              <SubSection title="Status pills">
                <div style={{ display: 'flex', gap: TOKENS.spacing.sm, flexWrap: 'wrap' }}>
                  <StatusPill tone="positive">Live</StatusPill>
                  <StatusPill tone="negative">Risk</StatusPill>
                  <StatusPill tone="neutral">Muted</StatusPill>
                  <StatusPill tone="accent">New</StatusPill>
                </div>
              </SubSection>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TOKENS.spacing.lg }}>
              <SubSection title="Underline tabs">
                <UnderlineTabs
                  options={['Overview', 'Tokens', 'NFTs', 'Activity']}
                  value={walletTab}
                  onChange={setWalletTab}
                />
              </SubSection>

              <SubSection title="Network filter pill">
                <NetworkFilterPill />
              </SubSection>
            </div>

            <SubSection title="Wallet identity header">
              <WalletIdentityHeader />
            </SubSection>

            <SubSection title="Toolbar controls">
              <div style={{ display: 'flex', gap: TOKENS.spacing.xs, flexWrap: 'wrap' }}>
                <ToolbarSelect
                  label="All genres"
                  compact
                  leading={
                    <span
                      style={{
                        position: 'relative',
                        width: '18px',
                        height: '18px',
                        display: 'inline-block',
                      }}
                    >
                      <span style={{ position: 'absolute', top: 0, left: 0, width: '8px', height: '8px', borderRadius: '999px', background: '#D7D9E0' }} />
                      <span style={{ position: 'absolute', top: 0, right: 0, width: '8px', height: '8px', borderRadius: '999px', background: TOKENS.colors.accent1 }} />
                      <span style={{ position: 'absolute', bottom: 0, left: 0, width: '8px', height: '8px', borderRadius: '999px', background: TOKENS.colors.base }} />
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: '8px', height: '8px', borderRadius: '999px', background: TOKENS.colors.critical }} />
                    </span>
                  }
                />
                <ToolbarSelect label="24H movers" compact />
                <ToolbarIconButton label="Search" icon={<Search size={26} />} />
              </div>
            </SubSection>
          </Section>

          <Section
            title="Components"
            subtitle="Standalone higher-order components."
          >
            <SubSection title="Section block">
              <MarketSectionBlock
                title="Section title"
                subtitle="Reusable frameless section wrapper for overview layouts."
              >
                <div
                  style={{
                    color: TOKENS.colors.neutral2,
                    fontSize: TOKENS.typography.body2.size,
                    lineHeight: TOKENS.typography.body2.lineHeight,
                  }}
                >
                  Section content sits directly on the page instead of inside a card.
                </div>
              </MarketSectionBlock>
            </SubSection>

            <SubSection title="Metric strip">
              <MarketStatStrip tokens={MOCK_TOKENS} />
            </SubSection>

            <SubSection title="Live metric hero">
              <LiveMetricHero
                label="Live platform CCU"
                value={livePlatformCcu.value}
                points={livePlatformCcu.ranges['1D']}
                tone={livePlatformCcu.tone}
              />
            </SubSection>

            <SubSection title="Revenue estimate hero">
              <RevenueEstimateHero chartHeight={220} />
            </SubSection>

            <SubSection title="Segmented control">
              <MarketSegmentedControl
                options={['1D', '1W', '1M'] as const}
                value="1D"
                onChange={() => {}}
              />
            </SubSection>

            <SubSection title="Tooltip">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: `${TOKENS.spacing.md} 0`,
                }}
              >
                <InfoTooltip
                  ariaLabel="Exceptional approval"
                  title="Exceptional Approval"
                  description="This game is liked by over 95% of players."
                  trigger={
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: TOKENS.spacing.xs,
                        color: TOKENS.colors.neutral1,
                        fontSize: TOKENS.typography.heading2.size,
                        lineHeight: TOKENS.typography.heading2.lineHeight,
                        fontWeight: TOKENS.typography.heading2.weight,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          color: TOKENS.colors.warning,
                          fontSize: '20px',
                          lineHeight: 1,
                        }}
                      >
                        ★
                      </span>
                      97.3%
                    </span>
                  }
                  icon={
                    <span
                      aria-hidden="true"
                      style={{
                        color: TOKENS.colors.warning,
                        fontSize: '24px',
                        lineHeight: 1,
                      }}
                    >
                      ★
                    </span>
                  }
                />
              </div>
            </SubSection>

            <SubSection title="Breadcrumbs">
              <MarketBreadcrumbs
                items={[
                  { label: 'Overview', onClick: () => {} },
                  { label: 'Action' },
                  { label: 'Grow a Garden' },
                ]}
              />
            </SubSection>

            <SubSection title="Surface panel">
              <SurfacePanel
                title="Quick facts"
                subtitle="Reusable elevated panel for side rails and dense stat blocks."
                trailing={<Search size={16} color={TOKENS.colors.neutral2} />}
              >
                <div style={{ display: 'grid', gap: TOKENS.spacing.sm }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: TOKENS.spacing.md }}>
                    <span style={{ color: TOKENS.colors.neutral2 }}>Live CCU</span>
                    <strong>1.92M</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: TOKENS.spacing.md }}>
                    <span style={{ color: TOKENS.colors.neutral2 }}>Approval</span>
                    <strong>91.4%</strong>
                  </div>
                </div>
              </SurfacePanel>
            </SubSection>

            <SubSection title="Compact games table">
              <GamesOverviewTable
                variant="compact"
                rows={trendingGames.map((game) => ({
                  name: game.title,
                  studio: game.subtitle,
                  primaryValue: game.primaryValue,
                  deltaValue: game.deltaValue,
                  trend: game.trend,
                  chartTone: game.tone ?? 'neutral',
                  accentColor: game.accentColor,
                }))}
                primaryLabel="Live CCU"
                deltaLabel="24H"
                showTrend
              />
            </SubSection>

            <SubSection title="Games overview table">
              <GamesOverviewTable rows={catalogGameRows} />
            </SubSection>

            <SubSection title="Category performance map">
              <CategoryPerformanceMap sections={catalogCategorySections} />
            </SubSection>

            <SubSection title="Token table">
              <TokenTable
                rows={sortedTokens}
                sortBy={sortBy}
                onSort={handleSort}
                hoveredRow={hoveredRow}
                setHoveredRow={setHoveredRow}
              />
            </SubSection>
          </Section>
        </div>
      </main>
    </div>
  )
}
