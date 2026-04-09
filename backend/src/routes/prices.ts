import { Router, Request, Response, NextFunction } from 'express';
import { fetchAllPrices } from '../lib/pacificaClient';
import { enrichMarkets, computeMarketStatsSummary } from '../lib/statistics';
import { cache } from '../lib/cache';
import { MarketWithStats } from '../types/pacifica';

const router = Router();

const CACHE_KEY_PRICES = 'prices:all';
const CACHE_KEY_STATS = 'prices:stats';

/**
 * GET /api/v1/prices
 *
 * Returns all markets enriched with computed stats:
 *   fundingRateNum, annualizedRate, zScore, isExtreme, extremeDirection, etc.
 *
 * Query params:
 *   sort  – "funding" | "annualized" | "zscore" | "oi" | "volume" (default: "annualized")
 *   order – "asc" | "desc" (default: "desc")
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    let markets = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);

    if (!markets) {
      const raw = await fetchAllPrices();
      markets = enrichMarkets(raw);
      cache.setPrices(CACHE_KEY_PRICES, markets);
      // Invalidate stats cache when prices refresh
      cache.del(CACHE_KEY_STATS);
    }

    const sort = (req.query.sort as string) ?? 'annualized';
    const order = (req.query.order as string) ?? 'desc';

    const sortFn: Record<string, (a: MarketWithStats, b: MarketWithStats) => number> = {
      funding: (a, b) => a.fundingRateNum - b.fundingRateNum,
      annualized: (a, b) => a.annualizedRate - b.annualizedRate,
      zscore: (a, b) => Math.abs(a.zScore) - Math.abs(b.zScore),
      oi: (a, b) => a.openInterestNum - b.openInterestNum,
      volume: (a, b) => a.volume24hNum - b.volume24hNum,
    };

    const comparator = sortFn[sort] ?? sortFn.annualized;
    const sorted = [...markets].sort((a, b) =>
      order === 'asc' ? comparator(a, b) : comparator(b, a),
    );

    res.json({ success: true, data: sorted, count: sorted.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/prices/stats
 *
 * Returns aggregate population statistics across all markets
 * (mean, stdDev, median, min, max).  Used by the frontend to
 * render deviation bands on charts.
 */
router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let stats = cache.getPrices<ReturnType<typeof computeMarketStatsSummary>>(CACHE_KEY_STATS);

    if (!stats) {
      let markets = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);
      if (!markets) {
        const raw = await fetchAllPrices();
        markets = enrichMarkets(raw);
        cache.setPrices(CACHE_KEY_PRICES, markets);
      }
      stats = computeMarketStatsSummary(markets);
      cache.setPrices(CACHE_KEY_STATS, stats);
    }

    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/prices/:symbol
 *
 * Returns a single market's enriched data by symbol.
 */
router.get('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    let markets = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);
    if (!markets) {
      const raw = await fetchAllPrices();
      markets = enrichMarkets(raw);
      cache.setPrices(CACHE_KEY_PRICES, markets);
    }

    const market = markets.find((m) => m.symbol === symbol);
    if (!market) {
      res.status(404).json({ success: false, error: `Market not found: ${symbol}` });
      return;
    }

    res.json({ success: true, data: market });
  } catch (err) {
    next(err);
  }
});

export default router;
