import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Blocks,
  ChartColumnIncreasing,
  House,
} from 'lucide-react'

import { TOKENS } from '../design/marketTokens'

type AppShellRoute = 'home' | 'components' | 'game'

type AppShellProps = {
  activeRoute: AppShellRoute
  onOpenHome: () => void
  onOpenComponents: () => void
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

export default function AppShell({
  activeRoute,
  onOpenHome,
  onOpenComponents,
  children,
}: AppShellProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return
      }

      const key = event.key.toLowerCase()

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
    </div>
  )
}
