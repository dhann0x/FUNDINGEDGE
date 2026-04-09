// ─────────────────────────────────────────────────────────────
//  Knights Labs – Pacifica API Type Definitions
// ─────────────────────────────────────────────────────────────

/** Standard envelope returned by every Pacifica REST call. */
export interface PacificaEnvelope<T> {
  success: boolean;
  data: T;
  error: string | null;
  code: string | null;
}

/** Shape of one market entry from GET /api/v1/info/prices */
export interface MarketPrice {
  symbol: string;
  /** Current hourly funding rate (string – always use parseFloat) */
  funding: string;
  /** Projected next hourly rate (TWAP of 5-second samples) */
  next_funding: string;
  mark: string;
  oracle: string;
  /** Mid price from orderbook */
  mid: string;
  /** Open interest in USD */
  open_interest: string;
  /** 24-hour volume in USD */
  volume_24h: string;
  yesterday_price: string;
  /** Unix ms timestamp */
  timestamp: number;
}

/** Shape of one record from GET /api/v1/funding_rate/history */
export interface FundingHistoryRecord {
  oracle_price: string;
  bid_impact_price: string;
  ask_impact_price: string;
  funding_rate: string;
  next_funding_rate: string;
  /** Unix ms timestamp */
  created_at: number;
}

/** Paginated response from GET /api/v1/funding_rate/history */
export interface FundingHistoryResponse {
  data: FundingHistoryRecord[];
  next_cursor: string | null;
  has_more: boolean;
}

/** Shape of one account funding payment from GET /api/v1/funding/history */
export interface FundingPayment {
  history_id: number;
  symbol: string;
  /** "bid" = was long, "ask" = was short at funding time */
  side: 'bid' | 'ask';
  /** Position size at payment time */
  amount: string;
  /** Positive = received funding, negative = paid funding */
  payout: string;
  rate: string;
  /** Unix ms timestamp */
  created_at: number;
}

/** Shape of one open position from GET /api/v1/positions */
export interface Position {
  symbol: string;
  /** bid = long, ask = short */
  side: 'bid' | 'ask';
  /** Position size in base token */
  amount: string;
  entry_price: string;
  /** Cumulative funding paid (negative) or received (positive) so far */
  funding: string;
  isolated: boolean;
}

/** Shape of one market spec from GET /api/v1/info */
export interface MarketInfo {
  symbol: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
//  Derived / Computed Types (produced by this backend)
// ─────────────────────────────────────────────────────────────

/** MarketPrice enriched with server-side computed statistics */
export interface MarketWithStats extends MarketPrice {
  /** parseFloat(funding) */
  fundingRateNum: number;
  /** fundingRateNum * 24 * 365 * 100  →  APY % */
  annualizedRate: number;
  /** parseFloat(next_funding) */
  nextFundingRateNum: number;
  /** nextFundingRateNum * 24 * 365 * 100 */
  nextAnnualizedRate: number;
  /** Δ between current and next annualized rate (trend signal) */
  rateDelta: number;
  /** (fundingRateNum - populationMean) / populationStdDev */
  zScore: number;
  /** |zScore| > threshold (default 2) */
  isExtreme: boolean;
  /** Direction of the extreme: longs pay → "short_favored"; shorts pay → "long_favored" */
  extremeDirection: 'long_favored' | 'short_favored' | null;
  /** parseFloat(open_interest) */
  openInterestNum: number;
  /** parseFloat(volume_24h) */
  volume24hNum: number;
}

/** One arbitrage opportunity pair */
export interface ArbitragePair {
  /** Symbol where funding rate is LOWER – go long here */
  longSymbol: string;
  longFundingRate: number;
  longAnnualizedRate: number;
  /** Symbol where funding rate is HIGHER – go short here */
  shortSymbol: string;
  shortFundingRate: number;
  shortAnnualizedRate: number;
  /** Absolute difference between the two hourly rates */
  spread: number;
  /** spread * 24 * 365 * 100 */
  spreadAnnualized: number;
  /** Estimated daily income per $10 000 deployed on each side */
  dailyIncomePerTenK: number;
}

/** Summary statistics across all markets (used by Extremes Detector) */
export interface MarketStatsSummary {
  mean: number;
  stdDev: number;
  median: number;
  min: number;
  max: number;
  count: number;
  computedAt: number;
}

/** Elfa AI sentiment response shape (subset we expose) */
export interface SentimentResult {
  symbol: string;
  mentionCount: number;
  sentimentScore: number;
  /** "bullish" | "bearish" | "neutral" */
  sentiment: string;
  fetchedAt: number;
}

/** Health check response */
export interface HealthStatus {
  status: 'ok' | 'degraded';
  uptime: number;
  pacificaWsConnected: boolean;
  cacheStats: {
    keys: number;
    hits: number;
    misses: number;
  };
  timestamp: number;
}
