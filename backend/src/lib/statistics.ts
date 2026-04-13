import {
  MarketPrice,
  MarketWithStats,
  ArbitragePair,
  CorrelatedArbitragePair,
  MarketStatsSummary,
  FundingSentimentDivergence,
  SentimentTrend,
} from '../types/pacifica';
import { config } from './config';

// ─────────────────────────────────────────────────────────────
//  Primitive stats helpers
// ─────────────────────────────────────────────────────────────

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function stdDev(values: number[], avg?: number): number {
  if (values.length < 2) return 0;
  const m = avg ?? mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Z-score: how many standard deviations `value` is from `populationMean`.
 * Returns 0 when stdDev is 0 to avoid NaN/Infinity.
 */
export function zScore(value: number, populationMean: number, populationStdDev: number): number {
  if (populationStdDev === 0) return 0;
  return (value - populationMean) / populationStdDev;
}

// ─────────────────────────────────────────────────────────────
//  Funding rate conversions
// ─────────────────────────────────────────────────────────────

/**
 * Convert an hourly funding rate to annualised APY percentage.
 * Formula: rate * 24 * 365 * 100
 * e.g. 0.0001 → 87.6 %
 */
export function toAnnualizedRate(hourlyRate: number): number {
  return hourlyRate * 24 * 365 * 100;
}

/**
 * Estimate daily funding income/cost for a given position size in USD.
 * Formula: rate * positionSizeUsd * 24
 */
export function dailyCost(hourlyRate: number, positionSizeUsd: number): number {
  return hourlyRate * positionSizeUsd * 24;
}

// ─────────────────────────────────────────────────────────────
//  Market enrichment
// ─────────────────────────────────────────────────────────────

/**
 * Enrich an array of raw MarketPrice objects with computed statistics.
 * The z-score is computed relative to the population of all markets
 * in the same snapshot, so it reflects how anomalous each rate is
 * compared to the current cross-market distribution.
 */
export function enrichMarkets(
  markets: MarketPrice[],
  zThreshold = config.stats.extremeZScoreThreshold,
): MarketWithStats[] {
  const rates = markets.map((m) => parseFloat(m.funding));
  const m = mean(rates);
  const sd = stdDev(rates, m);

  return markets.map((market, i) => {
    const fundingRateNum = rates[i];
    const nextFundingRateNum = parseFloat(market.next_funding);
    const annualizedRate = toAnnualizedRate(fundingRateNum);
    const nextAnnualizedRate = toAnnualizedRate(nextFundingRateNum);
    const z = zScore(fundingRateNum, m, sd);
    const isExtreme = Math.abs(z) >= zThreshold;

    // Positive funding → longs pay shorts → "short_favored" (short is attractive)
    // Negative funding → shorts pay longs → "long_favored"
    const extremeDirection: MarketWithStats['extremeDirection'] = isExtreme
      ? fundingRateNum > 0
        ? 'short_favored'
        : 'long_favored'
      : null;

    return {
      ...market,
      fundingRateNum,
      annualizedRate,
      nextFundingRateNum,
      nextAnnualizedRate,
      rateDelta: nextAnnualizedRate - annualizedRate,
      zScore: z,
      isExtreme,
      extremeDirection,
      openInterestNum: parseFloat(market.open_interest),
      volume24hNum: parseFloat(market.volume_24h),
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Cross-market statistics summary
// ─────────────────────────────────────────────────────────────

export function computeMarketStatsSummary(markets: MarketWithStats[]): MarketStatsSummary {
  const rates = markets.map((m) => m.fundingRateNum);
  const m = mean(rates);
  return {
    mean: m,
    stdDev: stdDev(rates, m),
    median: median(rates),
    min: Math.min(...rates),
    max: Math.max(...rates),
    count: rates.length,
    computedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Arbitrage screener
// ─────────────────────────────────────────────────────────────

/**
 * Find the top funding-rate arbitrage opportunities across all markets.
 *
 * Strategy: Long the market with a LOWER (or negative) funding rate while
 * simultaneously Shorting the market with a HIGHER rate. You collect the
 * spread on the short side while paying less (or receiving) on the long.
 *
 * Risk: Price divergence between the two assets. Prefer correlated pairs.
 */
export function findArbitragePairs(
  markets: MarketWithStats[],
  minSpread = config.stats.arbitrageMinSpread,
  maxPairs = config.stats.arbitrageMaxPairs,
): ArbitragePair[] {
  const pairs: ArbitragePair[] = [];

  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const a = markets[i];
      const b = markets[j];
      const spread = Math.abs(a.fundingRateNum - b.fundingRateNum);

      if (spread < minSpread) continue;

      // Orient so that longSymbol always has the lower rate
      const [longMkt, shortMkt] =
        a.fundingRateNum <= b.fundingRateNum ? [a, b] : [b, a];

      pairs.push({
        longSymbol: longMkt.symbol,
        longFundingRate: longMkt.fundingRateNum,
        longAnnualizedRate: longMkt.annualizedRate,
        shortSymbol: shortMkt.symbol,
        shortFundingRate: shortMkt.fundingRateNum,
        shortAnnualizedRate: shortMkt.annualizedRate,
        spread,
        spreadAnnualized: toAnnualizedRate(spread),
        dailyIncomePerTenK: dailyCost(spread, 10_000),
      });
    }
  }

  return pairs
    .sort((a, b) => b.spread - a.spread)
    .slice(0, maxPairs);
}

// ─────────────────────────────────────────────────────────────
//  Price correlation
// ─────────────────────────────────────────────────────────────

/**
 * Pearson correlation coefficient between two equal-length numeric series.
 * Returns 0 when either series has zero variance (constant prices).
 * Range: -1 (perfect inverse) to +1 (perfect positive).
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));

  let num = 0;
  let dx = 0;
  let dy = 0;

  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx;
    const yi = y[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }

  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/**
 * Align two timestamped price series into parallel numeric arrays
 * by bucketing into `bucketMs` intervals (default 1 hour).
 *
 * Both inputs are arrays of { price, ts } sorted newest-first
 * (matching Pacifica funding history response order).
 *
 * Returns only the buckets where BOTH series have data.
 */
export function alignPriceSeries(
  a: { price: number; ts: number }[],
  b: { price: number; ts: number }[],
  bucketMs = 60 * 60 * 1_000,
): { ax: number[]; ay: number[] } {
  const bucket = (ts: number) => Math.floor(ts / bucketMs) * bucketMs;

  const mapA = new Map<number, number>();
  for (const { price, ts } of a) mapA.set(bucket(ts), price);

  const ax: number[] = [];
  const ay: number[] = [];

  for (const { price, ts } of b) {
    const key = bucket(ts);
    if (mapA.has(key)) {
      ax.push(mapA.get(key)!);
      ay.push(price);
    }
  }

  return { ax, ay };
}

/**
 * Derive a human-readable risk label from a Pearson correlation.
 *   r ≥ 0.8  → low risk   (prices closely track each other)
 *   r ≥ 0.5  → medium risk
 *   r ≥ 0    → high risk
 *   r < 0    → uncorrelated (inverse or no relationship)
 */
function correlationRiskLabel(r: number): CorrelatedArbitragePair['riskLabel'] {
  if (r >= 0.8) return 'low';
  if (r >= 0.5) return 'medium';
  if (r >= 0) return 'high';
  return 'uncorrelated';
}

/**
 * Enrich an array of ArbitragePairs with price correlation data.
 *
 * @param pairs    Base arbitrage pairs (already sorted by spread)
 * @param histories Map of symbol → { price, ts }[] oracle price series
 */
export function enrichPairsWithCorrelation(
  pairs: ArbitragePair[],
  histories: Map<string, { price: number; ts: number }[]>,
): CorrelatedArbitragePair[] {
  return pairs.map((pair) => {
    const seriesA = histories.get(pair.longSymbol);
    const seriesB = histories.get(pair.shortSymbol);

    if (!seriesA || !seriesB || seriesA.length < 2 || seriesB.length < 2) {
      return {
        ...pair,
        correlation: 0,
        correlationWindow: 0,
        correlationAdjustedScore: 0,
        riskLabel: 'uncorrelated' as const,
      };
    }

    const { ax, ay } = alignPriceSeries(seriesA, seriesB);
    const r = pearsonCorrelation(ax, ay);

    return {
      ...pair,
      correlation: parseFloat(r.toFixed(4)),
      correlationWindow: ax.length,
      // Only positive correlation adds value; negative correlation means
      // the assets diverge — multiply by 0 to surface it but not rank it up.
      correlationAdjustedScore: parseFloat(
        (pair.spreadAnnualized * Math.max(0, r)).toFixed(4),
      ),
      riskLabel: correlationRiskLabel(r),
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Funding–sentiment divergence classifier
// ─────────────────────────────────────────────────────────────

/**
 * Classify the divergence between a market's funding rate and its
 * Elfa AI social sentiment trend.
 *
 * Signal logic (see type definition for full descriptions):
 *   funding < 0 (shorts paying) + sentiment rising  → SHORT_SQUEEZE_SETUP
 *   funding > 0 (longs paying)  + sentiment falling → LONG_LIQUIDATION_SETUP
 *   funding > 0 extreme         + sentiment rising  → OVEREXTENDED_LONG
 *   funding < 0 extreme         + sentiment falling → OVEREXTENDED_SHORT
 *   funding > 0 + sentiment rising (mild)           → ALIGNED_BULLISH
 *   funding < 0 + sentiment falling (mild)          → ALIGNED_BEARISH
 *   otherwise                                       → NEUTRAL
 */
export function classifyDivergence(
  market: MarketWithStats,
  trend: SentimentTrend,
  extremeZThreshold = config.stats.extremeZScoreThreshold,
): FundingSentimentDivergence {
  const { fundingRateNum, annualizedRate, zScore: fz } = market;
  const { trendStrength, trend: trendDir, sentimentScore } = trend.recent
    ? { trendStrength: trend.trendStrength, trend: trend.trend, sentimentScore: trend.recent.sentimentScore }
    : { trendStrength: 0, trend: 'flat' as const, sentimentScore: 0 };

  const shortsArePaying = fundingRateNum < 0;
  const longsArePaying = fundingRateNum > 0;
  const isExtremeFunding = Math.abs(fz) >= extremeZThreshold;
  const sentimentRising = trendDir === 'rising';
  const sentimentFalling = trendDir === 'falling';
  const strongTrend = Math.abs(trendStrength) >= 0.3;

  // Normalised signal strength: geometric mean of funding extremity and sentiment momentum
  const signalStrength = parseFloat(
    Math.min(1, Math.sqrt((Math.min(Math.abs(fz), 4) / 4) * Math.abs(trendStrength))).toFixed(3),
  );

  let signal: FundingSentimentDivergence['signal'];
  let explanation: string;

  if (shortsArePaying && sentimentRising && isExtremeFunding) {
    signal = 'SHORT_SQUEEZE_SETUP';
    explanation = `Shorts are paying an extreme rate (${annualizedRate.toFixed(1)}% APY) while social sentiment is rising — crowded shorts into bullish momentum is a classic squeeze setup.`;
  } else if (longsArePaying && sentimentFalling && isExtremeFunding) {
    signal = 'LONG_LIQUIDATION_SETUP';
    explanation = `Longs are paying an extreme rate (${annualizedRate.toFixed(1)}% APY) while social sentiment is deteriorating — crowded longs into falling momentum raises long liquidation risk.`;
  } else if (longsArePaying && sentimentRising && isExtremeFunding && strongTrend) {
    signal = 'OVEREXTENDED_LONG';
    explanation = `Both perp positioning and social sentiment are extremely bullish — this level of double-sided overextension often precedes a correction.`;
  } else if (shortsArePaying && sentimentFalling && isExtremeFunding && strongTrend) {
    signal = 'OVEREXTENDED_SHORT';
    explanation = `Both perp positioning and social sentiment are extremely bearish — double-sided overextension to the downside often produces sharp bounces.`;
  } else if (longsArePaying && sentimentRising) {
    signal = 'ALIGNED_BULLISH';
    explanation = `Mild bullish alignment: perp market is net long and social sentiment is improving. No extreme divergence detected.`;
  } else if (shortsArePaying && sentimentFalling) {
    signal = 'ALIGNED_BEARISH';
    explanation = `Mild bearish alignment: perp market is net short and social sentiment is declining. No extreme divergence detected.`;
  } else {
    signal = 'NEUTRAL';
    explanation = `Funding rate and social sentiment are not showing a meaningful divergence at this time.`;
  }

  return {
    symbol: market.symbol,
    fundingRate: fundingRateNum,
    annualizedRate,
    fundingZScore: fz,
    sentimentScore,
    sentimentTrend: trendDir,
    trendStrength,
    signal,
    signalStrength,
    explanation,
    computedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Historical per-market z-score (using stored history)
// ─────────────────────────────────────────────────────────────

/**
 * Compute a z-score for the CURRENT rate of a market relative to its own
 * historical distribution (last N hours).
 *
 * This is richer than the cross-market z-score because it tells you how
 * unusual this rate is compared to what THIS market normally does.
 */
export function historicalZScore(
  currentRate: number,
  historicalRates: number[],
): number {
  if (historicalRates.length < 2) return 0;
  const m = mean(historicalRates);
  const sd = stdDev(historicalRates, m);
  return zScore(currentRate, m, sd);
}
