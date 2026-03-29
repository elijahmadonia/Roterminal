import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import NumberFlow, { type Format } from '@number-flow/react'

import { InfoTooltip } from '../market-ui/InfoTooltip'
import { TOKENS } from '../../design/marketTokens'

type NumberFlowProps = ComponentProps<typeof NumberFlow>

type AnimatedNumberProps = Omit<NumberFlowProps, 'format' | 'value'> & {
  value: number | null | undefined
  format?: Format
  fallback?: ReactNode
  animateOnMount?: boolean
  mountValue?: number
  flashOnChange?: boolean
  flashDurationMs?: number
}

type WholeNumberProps = Omit<AnimatedNumberProps, 'format' | 'value'> & {
  value: number | null | undefined
}

type CompactNumberProps = Omit<AnimatedNumberProps, 'format' | 'value'> & {
  value: number | null | undefined
}

type PercentNumberProps = Omit<AnimatedNumberProps, 'format' | 'value' | 'suffix'> & {
  value: number | null | undefined
  fractionDigits?: number
  signed?: boolean
  suffix?: string
}

type ApprovalNumberProps = Omit<PercentNumberProps, 'signed'> & {
  highlightThreshold?: number
}

type CurrencyNumberProps = Omit<AnimatedNumberProps, 'format' | 'value'> & {
  value: number | null | undefined
  currency: string
  format?: Format
}

const BASE_STYLE: CSSProperties & Record<'--number-flow-mask-height' | '--number-flow-mask-width', string> = {
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 'inherit',
  '--number-flow-mask-height': '0.14em',
  '--number-flow-mask-width': '0.42em',
}

export function AnimatedNumber({
  value,
  fallback = 'Unavailable',
  format,
  locales = 'en-US',
  animateOnMount = true,
  mountValue = 0,
  flashOnChange = false,
  flashDurationMs = 260,
  style,
  ...props
}: AnimatedNumberProps) {
  const isValidValue = value != null && !Number.isNaN(value)
  const previousValueRef = useRef<number | null>(isValidValue ? value : null)
  const flashTimeoutRef = useRef<number | null>(null)
  const flashResetFrameRef = useRef<number | null>(null)
  const flashApplyFrameRef = useRef<number | null>(null)
  const [displayValue, setDisplayValue] = useState<number | null>(() => {
    if (!isValidValue) {
      return null
    }

    return animateOnMount ? mountValue : value
  })
  const [flashTone, setFlashTone] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    return () => {
      if (flashResetFrameRef.current != null) {
        window.cancelAnimationFrame(flashResetFrameRef.current)
      }

      if (flashApplyFrameRef.current != null) {
        window.cancelAnimationFrame(flashApplyFrameRef.current)
      }

      if (flashTimeoutRef.current != null) {
        window.clearTimeout(flashTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isValidValue) {
      previousValueRef.current = null
      return
    }

    const previousValue = previousValueRef.current

    if (
      flashOnChange &&
      previousValue != null &&
      previousValue !== value
    ) {
      if (flashTimeoutRef.current != null) {
        window.clearTimeout(flashTimeoutRef.current)
      }

      if (flashResetFrameRef.current != null) {
        window.cancelAnimationFrame(flashResetFrameRef.current)
      }

      if (flashApplyFrameRef.current != null) {
        window.cancelAnimationFrame(flashApplyFrameRef.current)
      }

      const nextFlashTone = value > previousValue ? 'up' : 'down'

      flashResetFrameRef.current = window.requestAnimationFrame(() => {
        setFlashTone(null)

        flashApplyFrameRef.current = window.requestAnimationFrame(() => {
          setFlashTone(nextFlashTone)
          flashTimeoutRef.current = window.setTimeout(() => {
            setFlashTone(null)
          }, flashDurationMs)
        })
      })
    }

    previousValueRef.current = value

    const frameId = window.requestAnimationFrame(() => {
      setDisplayValue(value)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [flashDurationMs, flashOnChange, isValidValue, value])

  const resolvedValue = isValidValue
    ? (displayValue ?? (animateOnMount ? mountValue : value))
    : null

  if (resolvedValue == null) {
    return <>{fallback}</>
  }

  const {
    color: styleColor,
    textShadow: styleTextShadow,
    transition: styleTransition,
    ...numberFlowStyle
  } = style ?? {}

  const flashColor = flashTone === 'up'
    ? TOKENS.colors.success
    : flashTone === 'down'
      ? TOKENS.colors.critical
      : styleColor
  const flashShadow = flashTone === 'up'
    ? '0 0 14px rgba(33, 201, 94, 0.28)'
    : flashTone === 'down'
      ? '0 0 14px rgba(236, 40, 60, 0.24)'
      : styleTextShadow

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        color: flashColor,
        textShadow: flashShadow,
        transition: styleTransition ?? 'color 180ms ease, text-shadow 220ms ease',
      }}
    >
      <NumberFlow
        value={resolvedValue}
        format={format}
        locales={locales}
        style={{
          ...BASE_STYLE,
          ...numberFlowStyle,
          color: 'inherit',
          textShadow: 'inherit',
        }}
        {...props}
      />
    </span>
  )
}

export function WholeNumber({ value, ...props }: WholeNumberProps) {
  const roundedValue = value == null || Number.isNaN(value) ? value : Math.round(value)

  return (
    <AnimatedNumber
      value={roundedValue}
      format={{ maximumFractionDigits: 0 }}
      {...props}
    />
  )
}

export function CompactNumber({ value, ...props }: CompactNumberProps) {
  return (
    <AnimatedNumber
      value={value}
      format={{
        notation: 'compact',
        maximumFractionDigits: value != null && value >= 1_000_000 ? 1 : 0,
      }}
      {...props}
    />
  )
}

export function PercentNumber({
  value,
  fractionDigits = 1,
  signed = false,
  suffix = '%',
  ...props
}: PercentNumberProps) {
  return (
    <AnimatedNumber
      value={value}
      format={{
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
        signDisplay: signed ? 'exceptZero' : 'auto',
      }}
      suffix={suffix}
      {...props}
    />
  )
}

export function ApprovalNumber({
  value,
  highlightThreshold = 95,
  style,
  ...props
}: ApprovalNumberProps) {
  const showHighlight =
    value != null && !Number.isNaN(value) && value >= highlightThreshold

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      {showHighlight ? (
        <InfoTooltip
          ariaLabel={`${highlightThreshold}%+ liked`}
          title="Exceptional Approval"
          description={`This game is liked by over ${highlightThreshold}% of players.`}
          trigger={
            <span
              aria-hidden="true"
              style={{
                color: TOKENS.colors.warning,
                fontSize: '0.9em',
                lineHeight: 1,
              }}
            >
              ★
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
      ) : null}
      <PercentNumber
        value={value}
        style={style}
        {...props}
      />
    </span>
  )
}

export function CurrencyNumber({
  value,
  currency,
  format,
  ...props
}: CurrencyNumberProps) {
  return (
    <AnimatedNumber
      value={value}
      format={{
        style: 'currency',
        currency,
        ...format,
      }}
      {...props}
    />
  )
}
