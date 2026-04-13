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

/**
 * ArbitragePair enriched with price correlation between the two assets.
 * A high positive correlation means the pair's prices move together —
 * reducing the risk that price divergence wipes out the funding edge.
 */
export interface CorrelatedArbitragePair extends ArbitragePair {
  /** Pearson r computed from oracle_price history — range -1 to 1 */
  correlation: number;
  /** Number of aligned hourly price records used in the correlation */
  correlationWindow: number;
  /**
   * Primary ranking metric: spreadAnnualized × max(0, correlation).
   * Pairs with negative or zero correlation score 0 — the funding edge
   * is real but the price divergence risk is unquantified.
   */
  correlationAdjustedScore: number;
  /** Human-readable risk label derived from correlation */
  riskLabel: 'low' | 'medium' | 'high' | 'uncorrelated';
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

/** A single point-in-time sentiment snapshot stored for trend calculation */
export interface SentimentSnapshot {
  sentimentScore: number;
  mentionCount: number;
  /** Label for the window this snapshot covers ("24h" | "7d") */
  window: string;
  /** Unix ms – when this snapshot was fetched */
  fetchedAt: number;
}

/** Sentiment trend for a symbol derived from comparing two time windows */
export interface SentimentTrend {
  symbol: string;
  /** Most recent 24-hour window */
  recent: SentimentSnapshot;
  /** Baseline: previous period (e.g. 7-day average minus last 24h) */
  baseline: SentimentSnapshot;
  /** recent.sentimentScore - baseline.sentimentScore */
  scoreDelta: number;
  /** Normalised -1 to 1: how strongly the trend is moving */
  trendStrength: number;
  /** Direction of the trend */
  trend: 'rising' | 'falling' | 'flat';
  fetchedAt: number;
}

/**
 * Divergence signal between Elfa sentiment trend and funding rate.
 * Surfaces setups where social sentiment and perp market positioning disagree.
 */
export interface FundingSentimentDivergence {
  symbol: string;
  /** Current hourly funding rate */
  fundingRate: number;
  annualizedRate: number;
  /** Cross-market z-score of the funding rate */
  fundingZScore: number;
  sentimentScore: number;
  sentimentTrend: 'rising' | 'falling' | 'flat';
  trendStrength: number;
  /**
   * Trading signal classification:
   *
   * SHORT_SQUEEZE_SETUP    – sentiment rising + shorts paying (funding < 0).
   *                          Perp market is net short but social mood is bullish.
   *                          Rising price could force short covering.
   *
   * LONG_LIQUIDATION_SETUP – sentiment falling + longs paying (funding > 0).
   *                          Perp market is net long but social mood is turning.
   *                          Could trigger cascading long exits.
   *
   * OVEREXTENDED_LONG      – sentiment rising strongly + longs paying and extreme.
   *                          Both social hype and perp crowding point the same way.
   *                          Mean-reversion risk is elevated.
   *
   * OVEREXTENDED_SHORT     – sentiment falling strongly + shorts paying and extreme.
   *                          Both social fear and perp crowding align.
   *                          Oversold bounce candidate.
   *
   * ALIGNED_BULLISH        – mild bullish alignment, no extreme divergence.
   * ALIGNED_BEARISH        – mild bearish alignment, no extreme divergence.
   * NEUTRAL                – insufficient divergence to classify.
   */
  signal:
    | 'SHORT_SQUEEZE_SETUP'
    | 'LONG_LIQUIDATION_SETUP'
    | 'OVEREXTENDED_LONG'
    | 'OVEREXTENDED_SHORT'
    | 'ALIGNED_BULLISH'
    | 'ALIGNED_BEARISH'
    | 'NEUTRAL';
  /** 0–1 composite of |fundingZScore| and |trendStrength| */
  signalStrength: number;
  /** One-line plain-English explanation for the frontend to display */
  explanation: string;
  computedAt: number;
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
