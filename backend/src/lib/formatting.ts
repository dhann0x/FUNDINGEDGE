/**
 * Formatting utilities shared across routes and WebSocket handlers.
 * Keep these pure functions – no I/O, no side effects.
 */

/** Format a funding rate as a percentage string with 4 decimal places. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

/** Format an annualised APY value (already in %) with 2 decimal places. */
export function formatApy(apy: number): string {
  return `${apy.toFixed(2)}%`;
}

/** Format a large USD value with commas and optional decimal places. */
export function formatUsd(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Round a number to N significant decimal places. */
export function round(value: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Convert a Unix ms timestamp to an ISO-8601 string. */
export function tsToIso(ms: number): string {
  return new Date(ms).toISOString();
}
