import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Blocks,
  ChartColumnIncreasing,
  House,
  LoaderCircle,
  Search,
} from 'lucide-react'

import { searchRobloxGamesByName, type RobloxSearchMatch } from '../api/roblox'
import { topGamesByCcu } from '../data/homeOverview'
import { TOKENS } from '../design/marketTokens'

type AppShellRoute = 'home' | 'components' | 'game'

type AppShellProps = {
  activeRoute: AppShellRoute
  onOpenHome: () => void
  onOpenComponents: () => void
  onOpenGame: (game: { universeId?: number; name: string }) => Promise<void>
  children: ReactNode
}

type RailButtonProps = {
  active?: boolean
  icon: LucideIcon
  label: string
  shortcut: string
  tooltipLabel: string
  onClick?: () => void
}

type SearchQuickItem = {
  key: string
  name: string
  subtitle: string
  meta: string
  accentColor: string
  universeId?: number
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return (
    target.isContentEditable ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  )
}

function LogoMark({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      aria-label="Open home"
      title="Open home"
      onClick={() => {
        setHovered(false)
        onClick()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: 'none',
        background: 'transparent',
        padding: 0,
        color: TOKENS.colors.neutral1,
        cursor: 'pointer',
        opacity: hovered ? 1 : 0.9,
        transition: `opacity ${TOKENS.transitions.fast}, transform ${TOKENS.transitions.fast}`,
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <span
        style={{
          fontSize: '38px',
          lineHeight: 1,
          fontWeight: 600,
          letterSpacing: '-0.08em',
        }}
      >
        R
      </span>
    </button>
  )
}

function RailButton({
  active = false,
  icon: Icon,
  label,
  shortcut,
  tooltipLabel,
  onClick,
}: RailButtonProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const interactive = Boolean(onClick)
  const showHoverCard = hovered || focused
  const interactiveState = hovered || focused
  const background = active
    ? TOKENS.colors.surface4
    : interactiveState
      ? TOKENS.colors.surface2
      : 'transparent'
  const color = active || interactiveState
    ? TOKENS.colors.neutral1
    : TOKENS.colors.neutral2

  return (
    <div
      className="app-shell__navItem"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="app-shell__navButton"
        onClick={() => {
          setHovered(false)
          setFocused(false)
          onClick?.()
        }}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        aria-disabled={!interactive}
        title={label}
        tabIndex={interactive ? 0 : -1}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          border: 'none',
          outline: 'none',
          background,
          color,
          cursor: interactive ? 'pointer' : 'default',
          boxShadow: 'none',
          transform: 'none',
        }}
      >
        <Icon aria-hidden="true" size={22} />
      </button>

      <div
        className={`app-shell__hoverCard${showHoverCard ? ' is-visible' : ''}`}
        aria-hidden="true"
        style={{
          background: TOKENS.colors.neutral1,
          color: TOKENS.colors.surface1,
          border: `1px solid ${TOKENS.colors.neutral4}CC`,
          boxShadow: TOKENS.shadows.menu,
        }}
      >
        <span
          style={{
            fontSize: TOKENS.typography.body2.size,
            lineHeight: TOKENS.typography.body2.lineHeight,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          {tooltipLabel}
        </span>
        <span
          className="app-shell__hoverShortcut"
          style={{
            background: TOKENS.colors.surface2,
            color: TOKENS.colors.neutral1,
            fontSize: TOKENS.typography.body3.size,
            lineHeight: TOKENS.typography.body3.lineHeight,
            border: `1px solid ${TOKENS.colors.neutral4}55`,
          }}
        >
          {shortcut}
        </span>
      </div>
    </div>
  )
}

function UserPlaceholder() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: '32px',
        height: '32px',
        borderRadius: TOKENS.radii.round,
        background: TOKENS.colors.surface3,
        color: TOKENS.colors.neutral1,
        display: 'grid',
        placeItems: 'center',
        fontSize: TOKENS.typography.body2.size,
        lineHeight: TOKENS.typography.body2.lineHeight,
        fontWeight: 600,
      }}
    >
      E
    </div>
  )
}

function formatCompactPlayers(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M playing`
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K playing`
  }

  return `${value.toLocaleString('en-US')} playing`
}

function SearchResultGlyph({
  label,
  accentColor,
}: {
  label: string
  accentColor: string
}) {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div
      aria-hidden="true"
      className="app-shell__searchResultGlyph"
      style={{
        background: `linear-gradient(135deg, ${accentColor}CC, ${accentColor}66)`,
        color: TOKENS.colors.neutral1,
      }}
    >
      {initials || 'R'}
    </div>
  )
}

function SearchOverlay({
  isOpen,
  query,
  onQueryChange,
  featuredItems,
  results,
  isPending,
  error,
  onClose,
  onSelect,
}: {
  isOpen: boolean
  query: string
  onQueryChange: (value: string) => void
  featuredItems: SearchQuickItem[]
  results: RobloxSearchMatch[]
  isPending: boolean
  error: string | null
  onClose: () => void
  onSelect: (item: { universeId?: number; name: string }) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const normalizedQuery = query.trim()
  const hasLiveQuery = normalizedQuery.length >= 2
  const visibleResults = hasLiveQuery ? results : []
  const primaryList = hasLiveQuery ? visibleResults : featuredItems
  const sectionTitle = hasLiveQuery ? 'Results' : 'Most active'

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="app-shell__searchOverlay"
      role="presentation"
      onClick={onClose}
      style={{
        background: 'linear-gradient(180deg, rgba(0, 0, 0, 0.26), rgba(0, 0, 0, 0.64))',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search games"
        className="app-shell__searchPanel"
        onClick={(event) => event.stopPropagation()}
        style={{
          background: `linear-gradient(180deg, ${TOKENS.colors.surface4}, ${TOKENS.colors.surface2})`,
          border: `1px solid ${TOKENS.colors.neutral4}C0`,
          boxShadow: '0 36px 80px rgba(0, 0, 0, 0.42)',
        }}
      >
        <div
          className="app-shell__searchField"
          style={{
            background: '#202020',
            border: `1px solid ${TOKENS.colors.neutral4}44`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
          }}
        >
          <Search size={20} color={TOKENS.colors.neutral2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search experience, place link, or universe"
            className="app-shell__searchInput"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return
              }

              const firstItem = hasLiveQuery ? results[0] : featuredItems[0]
              const fallbackQuery = normalizedQuery

              if (!firstItem && fallbackQuery.length === 0) {
                return
              }

              event.preventDefault()
              onSelect({
                universeId: firstItem?.universeId,
                name: firstItem?.name ?? fallbackQuery,
              })
            }}
            style={{
              color: TOKENS.colors.neutral1,
              caretColor: TOKENS.colors.neutral1,
            }}
          />
          {isPending ? <LoaderCircle className="app-shell__searchSpinner" size={18} /> : null}
        </div>

        <div className="app-shell__searchMetaRow">
          <span
            style={{
              color: TOKENS.colors.neutral2,
              fontSize: TOKENS.typography.heading3.size,
              lineHeight: TOKENS.typography.heading3.lineHeight,
              fontWeight: 500,
              letterSpacing: TOKENS.typography.heading3.letterSpacing,
            }}
          >
            {sectionTitle}
          </span>
          <span
            style={{
              color: TOKENS.colors.neutral3,
              fontSize: TOKENS.typography.body3.size,
              lineHeight: TOKENS.typography.body3.lineHeight,
            }}
          >
            {hasLiveQuery
              ? 'Press Enter to open the first match'
              : 'Press / to jump here from anywhere'}
          </span>
        </div>

        <div className="app-shell__searchResults">
          {error ? (
            <div className="app-shell__searchStatus">
              {error}
            </div>
          ) : null}

          {!error && !isPending && hasLiveQuery && visibleResults.length === 0 ? (
            <div className="app-shell__searchStatus">
              No matches yet. Try a broader game name or paste a Roblox place link.
            </div>
          ) : null}

          {!error && primaryList.length > 0 ? (
            primaryList.map((item) => {
              const isMatch = 'creatorName' in item
              const subtitle = isMatch ? item.creatorName : item.subtitle
              const metaLabel = isMatch ? formatCompactPlayers(item.playerCount) : item.meta
              const accentColor = isMatch
                ? TOKENS.colors.base
                : item.accentColor

              return (
                <button
                  key={isMatch ? item.universeId : item.key}
                  type="button"
                  className="app-shell__searchResult"
                  onClick={() => onSelect({ universeId: item.universeId, name: item.name })}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${TOKENS.colors.neutral4}40`,
                  }}
                >
                  <div className="app-shell__searchResultMain">
                    <SearchResultGlyph
                      label={item.name}
                      accentColor={accentColor}
                    />

                    <div className="app-shell__searchResultCopy">
                      <div
                        style={{
                          color: TOKENS.colors.neutral1,
                          fontSize: TOKENS.typography.heading3.size,
                          lineHeight: TOKENS.typography.heading3.lineHeight,
                          fontWeight: 500,
                          letterSpacing: TOKENS.typography.heading3.letterSpacing,
                        }}
                      >
                        {item.name}
                      </div>
                      <div
                        style={{
                          color: TOKENS.colors.neutral2,
                          fontSize: TOKENS.typography.body2.size,
                          lineHeight: TOKENS.typography.body2.lineHeight,
                        }}
                      >
                        {subtitle}
                      </div>
                    </div>
                  </div>

                  <span
                    className="app-shell__searchBadge"
                    style={{
                      color: TOKENS.colors.neutral2,
                      border: `1px solid ${TOKENS.colors.neutral4}AA`,
                      background: 'rgba(255, 255, 255, 0.02)',
                    }}
                  >
                    {metaLabel}
                  </span>
                </button>
              )
            })
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function AppShell({
  activeRoute,
  onOpenHome,
  onOpenComponents,
  onOpenGame,
  children,
}: AppShellProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<RobloxSearchMatch[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const featuredSearchItems = useMemo<SearchQuickItem[]>(
    () =>
      topGamesByCcu.slice(0, 6).map((game) => ({
        key: game.title,
        name: game.title,
        subtitle: game.subtitle,
        meta: `${game.primaryValue} CCU`,
        accentColor: game.accentColor,
      })),
    [],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const shouldOpenSearch = (event.metaKey || event.ctrlKey) && key === 'k'

      if (shouldOpenSearch) {
        event.preventDefault()
        setIsSearchOpen(true)
        return
      }

      if (event.altKey || event.metaKey || event.ctrlKey || isTypingTarget(event.target)) {
        return
      }

      if (key === '/') {
        event.preventDefault()
        setIsSearchOpen(true)
        return
      }

      if (key === 'h') {
        event.preventDefault()
        onOpenHome()
      }

      if (key === 'c') {
        event.preventDefault()
        onOpenComponents()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenComponents, onOpenHome])

  useEffect(() => {
    if (!isSearchOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      setIsSearchOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSearchOpen])

  useEffect(() => {
    const normalizedQuery = searchQuery.trim()

    if (!isSearchOpen || normalizedQuery.length < 2) {
      setSearchResults([])
      setSearchError(null)
      setIsSearchPending(false)
      return
    }

    let isCancelled = false
    setIsSearchPending(true)
    setSearchError(null)

    const timeout = window.setTimeout(async () => {
      try {
        const matches = await searchRobloxGamesByName(normalizedQuery)

        if (isCancelled) {
          return
        }

        setSearchResults(matches.slice(0, 8))
      } catch (error) {
        if (isCancelled) {
          return
        }

        console.error(error)
        setSearchResults([])
        setSearchError('Search is unavailable right now.')
      } finally {
        if (!isCancelled) {
          setIsSearchPending(false)
        }
      }
    }, 160)

    return () => {
      isCancelled = true
      window.clearTimeout(timeout)
    }
  }, [isSearchOpen, searchQuery])

  const handleSearchSelection = async ({
    universeId,
    name,
  }: {
    universeId?: number
    name: string
  }) => {
    try {
      setSearchError(null)
      await onOpenGame({ universeId, name })
      setIsSearchOpen(false)
    } catch (error) {
      console.error(error)
      setSearchError(error instanceof Error ? error.message : 'Unable to open that experience.')
    }
  }

  return (
    <div
      className="app-shell"
      style={{
        background: TOKENS.colors.surface1,
        color: TOKENS.colors.neutral1,
        fontFamily: TOKENS.typography.fontFamily,
      }}
    >
      <aside className="app-shell__sidebar" aria-label="Primary">
        <div className="app-shell__sidebarFrame">
          <div className="app-shell__group">
            <LogoMark onClick={onOpenHome} />

            <div className="app-shell__group app-shell__group--primary">
              <RailButton
                icon={Search}
                label="Search games"
                shortcut="/"
                tooltipLabel="Search games"
                active={isSearchOpen}
                onClick={() => setIsSearchOpen(true)}
              />
              <RailButton
                icon={House}
                label="Home"
                shortcut="H"
                tooltipLabel="Go to Home"
                active={activeRoute === 'home'}
                onClick={onOpenHome}
              />
              <RailButton
                icon={Blocks}
                label="Components"
                shortcut="C"
                tooltipLabel="Go to Components"
                active={activeRoute === 'components'}
                onClick={onOpenComponents}
              />
              {activeRoute === 'game' ? (
                <RailButton
                  icon={ChartColumnIncreasing}
                  label="Game detail"
                  shortcut="G"
                  tooltipLabel="Current Game Detail"
                  active
                />
              ) : null}
            </div>
          </div>

          <div className="app-shell__group app-shell__group--footer">
            <UserPlaceholder />
          </div>
        </div>
      </aside>

      <div className="app-shell__content">{children}</div>

      <SearchOverlay
        isOpen={isSearchOpen}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        featuredItems={featuredSearchItems}
        results={searchResults}
        isPending={isSearchPending}
        error={searchError}
        onClose={() => setIsSearchOpen(false)}
        onSelect={handleSearchSelection}
      />
    </div>
  )
}
