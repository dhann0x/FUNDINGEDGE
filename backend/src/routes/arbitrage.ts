import { Router, Request, Response, NextFunction } from 'express';
import { fetchAllPrices, fetchFundingHistory } from '../lib/pacificaClient';
import {
  enrichMarkets,
  findArbitragePairs,
  enrichPairsWithCorrelation,
} from '../lib/statistics';
import { cache } from '../lib/cache';
import { MarketWithStats, CorrelatedArbitragePair } from '../types/pacifica';
import { config } from '../lib/config';

const router = Router();
const CACHE_KEY_PRICES = 'prices:all';

// ─────────────────────────────────────────────────────────────
//  GET /api/v1/arbitrage
// ─────────────────────────────────────────────────────────────

/**
 * Returns the top funding-rate arbitrage opportunities ranked by spread.
 *
 * Query params:
 *   minSpread – minimum hourly rate spread to include (default from config)
 *   maxPairs  – maximum pairs to return (default from config)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const minSpread = parseFloat(
      (req.query.minSpread as string) ?? String(config.stats.arbitrageMinSpread),
    );
    const maxPairs = parseInt(
      (req.query.maxPairs as string) ?? String(config.stats.arbitrageMaxPairs),
      10,
    );

    const cacheKey = `arbitrage:pairs:${minSpread}:${maxPairs}`;
    const cached = cache.getPrices<unknown[]>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, count: cached.length });
      return;
    }

    let markets = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);
    if (!markets) {
      const raw = await fetchAllPrices();
      markets = enrichMarkets(raw);
      cache.setPrices(CACHE_KEY_PRICES, markets);
    }

    const pairs = findArbitragePairs(markets, minSpread, maxPairs);
    cache.setPrices(cacheKey, pairs);
    res.json({ success: true, data: pairs, count: pairs.length });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/v1/arbitrage/correlated
// ─────────────────────────────────────────────────────────────

/**
 * Correlation-weighted arbitrage screener.
 *
 * Extends the base arbitrage pairs with Pearson price correlation computed
 * from oracle_price series in funding history. Each pair gains:
 *   correlation             – Pearson r (-1 to 1)
 *   correlationWindow       – number of aligned hourly records used
 *   correlationAdjustedScore – spreadAnnualized × max(0, correlation)
 *   riskLabel               – "low" | "medium" | "high" | "uncorrelated"
 *
 * Sorted by correlationAdjustedScore descending (best risk-adjusted pairs first).
 *
 * Query params:
 *   minSpread      – minimum hourly spread (default from config)
 *   maxPairs       – max pairs to evaluate for correlation (default from config)
 *   historyWindow  – hourly records per symbol for correlation (default 168 = 7 days)
 */
router.get('/correlated', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const minSpread = parseFloat(
      (req.query.minSpread as string) ?? String(config.stats.arbitrageMinSpread),
    );
    const maxPairs = parseInt(
      (req.query.maxPairs as string) ?? String(config.stats.arbitrageMaxPairs),
      10,
    );
    const historyWindow = Math.min(
      parseInt((req.query.historyWindow as string) ?? String(config.stats.historyWindowSize), 10),
      4000,
    );

    const cacheKey = `arbitrage:correlated:${minSpread}:${maxPairs}:${historyWindow}`;
    const cached = cache.getStandard<CorrelatedArbitragePair[]>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, count: cached.length });
      return;
    }

    // ── Step 1: get base pairs ────────────────────────────────
    let markets = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);
    if (!markets) {
      const raw = await fetchAllPrices();
      markets = enrichMarkets(raw);
      cache.setPrices(CACHE_KEY_PRICES, markets);
    }

    const basePairs = findArbitragePairs(markets, minSpread, maxPairs);
    if (basePairs.length === 0) {
      res.json({ success: true, data: [], count: 0 });
      return;
    }

    // ── Step 2: collect unique symbols ────────────────────────
    const symbols = new Set<string>();
    for (const p of basePairs) {
      symbols.add(p.longSymbol);
      symbols.add(p.shortSymbol);
    }

    // ── Step 3: fetch oracle_price history in parallel ────────
    const historyMap = new Map<string, { price: number; ts: number }[]>();

    await Promise.all(
      Array.from(symbols).map(async (symbol) => {
        const histCacheKey = `correlation:history:${symbol}:${historyWindow}`;
        let series = cache.getStandard<{ price: number; ts: number }[]>(histCacheKey);

        if (!series) {
          try {
            const page = await fetchFundingHistory(symbol, historyWindow);
            series = page.data.map((r) => ({
              price: parseFloat(r.oracle_price),
              ts: r.created_at,
            }));
            cache.setStandard(histCacheKey, series);
          } catch {
            series = []; // if a symbol fails, proceed without it
          }
        }

        historyMap.set(symbol, series);
      }),
    );

    // ── Step 4: enrich pairs with correlation ─────────────────
    const correlated = enrichPairsWithCorrelation(basePairs, historyMap)
      .sort((a, b) => b.correlationAdjustedScore - a.correlationAdjustedScore);

    cache.setStandard(cacheKey, correlated);
    res.json({ success: true, data: correlated, count: correlated.length });
  } catch (err) {
    next(err);
  }
});

export default router;
