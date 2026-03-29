import {
  cloneElement,
  isValidElement,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { TOKENS } from '../../design/marketTokens'

export type MarketButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'outline'

type MarketButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  leadingIcon?: ReactNode
  variant?: MarketButtonVariant
}

export function MarketButton({
  children,
  leadingIcon,
  variant = 'primary',
  disabled = false,
  style,
  onMouseEnter,
  onMouseLeave,
  ...props
}: MarketButtonProps) {
  const [hovered, setHovered] = useState(false)
  const styles: Record<MarketButtonVariant, { background: string; border: string; color: string }> = {
    primary: {
      background: TOKENS.colors.accent1,
      border: '1px solid transparent',
      color: TOKENS.colors.surface1,
    },
    secondary: {
      background: 'rgba(255, 55, 199, 0.08)',
      border: '1px solid transparent',
      color: TOKENS.colors.accent1,
    },
    tertiary: {
      background: TOKENS.colors.surface2,
      border: '1px solid transparent',
      color: TOKENS.colors.neutral1,
    },
    outline: {
      background: 'transparent',
      border: `1px solid ${TOKENS.colors.neutral4}`,
      color: TOKENS.colors.neutral1,
    },
  }

  const baseStyle = styles[variant]
  const background =
    disabled
      ? baseStyle.background
      : variant === 'primary'
        ? hovered
          ? TOKENS.colors.accent1Hover
          : baseStyle.background
        : variant === 'secondary'
          ? hovered
            ? 'rgba(255, 55, 199, 0.12)'
            : baseStyle.background
          : variant === 'tertiary'
            ? hovered
              ? TOKENS.colors.surface4
              : baseStyle.background
            : hovered
              ? TOKENS.colors.surface2
              : baseStyle.background
  const border =
    disabled || variant !== 'outline' || !hovered
      ? baseStyle.border
      : `1px solid ${TOKENS.colors.neutral4}AA`
  const color =
    disabled
      ? baseStyle.color
      : variant === 'secondary' && hovered
        ? TOKENS.colors.accent1Hover
        : baseStyle.color
  const icon =
    isValidElement<{ size?: number | string; color?: string; style?: CSSProperties }>(
      leadingIcon,
    )
      ? cloneElement(leadingIcon, {
          size: 18,
          color: 'currentColor',
          style: {
            display: 'block',
            color: 'currentColor',
            ...(leadingIcon.props.style ?? {}),
          },
        })
      : leadingIcon

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={(event) => {
        setHovered(true)
        onMouseEnter?.(event)
      }}
      onMouseLeave={(event) => {
        setHovered(false)
        onMouseLeave?.(event)
      }}
      style={{
        display: 'inline-flex',
        boxSizing: 'border-box',
        position: 'relative',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'stretch',
        gap: '8px',
        minWidth: '96px',
        minHeight: 0,
        height: 'auto',
        padding: '12px 16px',
        borderRadius: TOKENS.radii.lg,
        fontSize: '16px',
        lineHeight: '20.7px',
        fontWeight: 535,
        fontFamily:
          'Basel, -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        cursor: disabled ? 'not-allowed' : 'pointer',
        outlineColor: 'transparent',
        transform: 'scale(1)',
        transition: `background ${TOKENS.transitions.fast}, border-color ${TOKENS.transitions.fast}, color ${TOKENS.transitions.fast}, opacity ${TOKENS.transitions.fast}, transform 100ms cubic-bezier(0.17, 0.67, 0.45, 1)`,
        opacity: disabled ? 0.45 : 1,
        background,
        border,
        color,
        ...style,
      }}
      {...props}
    >
      {leadingIcon ? (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 0,
            color: 'inherit',
            width: '18px',
            height: '18px',
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      ) : null}
      <span
        style={{
          display: 'block',
          margin: 0,
          maxWidth: '100%',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textAlign: 'center',
          color: 'inherit',
          fontFamily:
            'Basel, -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: '16px',
          lineHeight: '20.7px',
          fontWeight: 535,
        }}
      >
        {children}
      </span>
    </button>
  )
}
