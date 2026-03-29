export const TOKENS = {
  colors: {
    accent1: '#FF37C7',
    accent1Hover: '#E500A5',
    accent2: '#FF007A',
    surface1: '#131313',
    surface2: '#1B1B1B',
    surface3: 'rgba(255, 255, 255, 0.12)',
    surface4: '#2B2B2B',
    neutral1: '#FFFFFF',
    neutral2: '#9B9B9B',
    neutral3: '#5E5E5E',
    neutral4: '#404040',
    success: '#21C95E',
    critical: 'rgb(236 40 60)',
    warning: '#EEB317',
    scrim: 'rgba(0, 0, 0, 0.60)',
    ethereum: '#627EEA',
    polygon: '#8247E5',
    arbitrum: '#28A0F0',
    optimism: '#FF0420',
    base: '#0052FF',
    bnb: '#F0B90B',
  },
  typography: {
    fontFamily: "'Basel', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    display2: { size: '36px', weight: 500, lineHeight: '44px', letterSpacing: '-0.02em' },
    heading1: { size: '28px', weight: 500, lineHeight: '36px', letterSpacing: '-0.02em' },
    heading2: { size: '20px', weight: 500, lineHeight: '28px', letterSpacing: '-0.01em' },
    heading3: { size: '16px', weight: 500, lineHeight: '24px', letterSpacing: '0' },
    body1: { size: '16px', weight: 400, lineHeight: '24px', letterSpacing: '0' },
    body2: { size: '14px', weight: 400, lineHeight: '20px', letterSpacing: '0' },
    body3: { size: '12px', weight: 400, lineHeight: '16px', letterSpacing: '0' },
  },
  spacing: {
    xxs: '4px',
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  radii: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    xxl: '24px',
    pill: '9999px',
    round: '50%',
  },
  shadows: {
    card: '0px 0px 1px rgba(0,0,0,0.30)',
    menu: '0px 4px 12px rgba(0,0,0,0.3), 0px 0px 1px rgba(0,0,0,0.4)',
  },
  transitions: {
    fast: '125ms ease',
    normal: '250ms ease',
  },
} as const

export const NETWORKS = [
  { name: 'Ethereum', color: TOKENS.colors.ethereum, icon: '◆' },
  { name: 'Polygon', color: TOKENS.colors.polygon, icon: '▲' },
  { name: 'Arbitrum', color: TOKENS.colors.arbitrum, icon: '◈' },
  { name: 'Base', color: TOKENS.colors.base, icon: '■' },
] as const

export const TIME_PERIODS = ['1H', '1D', '1W', '1M'] as const

export const TYPOGRAPHY_SPECS = [
  ['display2', TOKENS.typography.display2],
  ['heading1', TOKENS.typography.heading1],
  ['heading2', TOKENS.typography.heading2],
  ['heading3', TOKENS.typography.heading3],
  ['body1', TOKENS.typography.body1],
  ['body2', TOKENS.typography.body2],
  ['body3', TOKENS.typography.body3],
] as const
