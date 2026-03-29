export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000000 ? 1 : 0,
  }).format(value)
}

export function formatAxisNumber(value: number, span?: number): string {
  const absolute = Math.abs(value)

  if (absolute >= 1000) {
    let maximumFractionDigits = absolute >= 1000000 ? 1 : 0

    if (span != null) {
      if (span < 1_000) {
        maximumFractionDigits = 2
      } else if (span < 10_000) {
        maximumFractionDigits = 1
      }
    }

    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      minimumFractionDigits: maximumFractionDigits,
      maximumFractionDigits,
    }).format(value)
  }

  if (absolute >= 100) {
    return formatWholeNumber(Math.round(value))
  }

  if (absolute >= 10) {
    return value.toFixed(1)
  }

  return value.toFixed(2)
}

export function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatApproval(value: number): string {
  return `${value.toFixed(1)}% liked`
}

export function formatApprovalPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'Unavailable'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Unavailable'
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed)
}

export function formatNumberOrUnavailable(
  value: number | null | undefined,
  formatter: (value: number) => string = formatWholeNumber,
): string {
  if (value == null || Number.isNaN(value)) {
    return 'Unavailable'
  }

  return formatter(value)
}

export function formatRelativeUpdate(value: string): string {
  const updatedAt = new Date(value)
  const diffMs = Date.now() - updatedAt.getTime()
  const diffHours = Math.max(Math.round(diffMs / (1000 * 60 * 60)), 0)

  if (diffHours < 1) {
    return 'Updated <1h ago'
  }

  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`
  }

  const diffDays = Math.round(diffHours / 24)
  return `Updated ${diffDays}d ago`
}
