import { Router, Request, Response, NextFunction } from 'express';
import { fetchAllPrices } from '../lib/pacificaClient';
import { enrichMarkets, findArbitragePairs } from '../lib/statistics';
import { cache } from '../lib/cache';
import { MarketWithStats } from '../types/pacifica';
import { config } from '../lib/config';

const router = Router();
const CACHE_KEY_PRICES = 'prices:all';
const CACHE_KEY_ARB = 'arbitrage:pairs';

/**
 * GET /api/v1/arbitrage
 *
 * Returns the top funding-rate arbitrage opportunities across all markets.
 *
 * Strategy: Long the market with lower funding (pay less / receive more)
 * while simultaneously Shorting the market with higher funding (receive more).
 *
 * Query params:
 *   minSpread – minimum hourly rate spread to include (default from config)
 *   maxPairs  – maximum pairs to return (default from config)
 *
 * Each pair includes:
 *   longSymbol, shortSymbol, spread, spreadAnnualized, dailyIncomePerTenK
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

    const cacheKey = `${CACHE_KEY_ARB}:${minSpread}:${maxPairs}`;
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

export default router;
