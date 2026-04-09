import {
  MarketPrice,
  MarketWithStats,
  ArbitragePair,
  MarketStatsSummary,
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
