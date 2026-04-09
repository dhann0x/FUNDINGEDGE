import { Router, Request, Response, NextFunction } from 'express';
import { fetchFundingHistory, fetchFundingHistoryAll } from '../lib/pacificaClient';
import { historicalZScore, toAnnualizedRate, mean, stdDev } from '../lib/statistics';
import { cache } from '../lib/cache';
import { FundingHistoryRecord } from '../types/pacifica';

const router = Router();

/**
 * GET /api/v1/history/:symbol
 *
 * Funding rate history for one market.
 *
 * Query params:
 *   limit   – records to return (default 200, max 4000)
 *   cursor  – pagination cursor from previous response
 *   full    – "true" to auto-paginate and return ALL available records
 *
 * Each record is enriched with:
 *   fundingRateNum      – parsed float
 *   annualizedRate      – APY %
 *   historicalZScore    – z-score relative to the returned window
 */
router.get('/:symbol', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = Math.min(parseInt((req.query.limit as string) ?? '200', 10), 4000);
    const cursor = req.query.cursor as string | undefined;
    const full = req.query.full === 'true';

    const cacheKey = `history:${symbol}:${full ? 'full' : `${limit}:${cursor ?? ''}`}`;
    const cached = cache.getStandard<unknown>(cacheKey);
    if (cached) {
      res.json({ success: true, ...cached });
      return;
    }

    let records: FundingHistoryRecord[];
    let nextCursor: string | null = null;
    let hasMore = false;

    if (full) {
      records = await fetchFundingHistoryAll(symbol, 4000);
    } else {
      const page = await fetchFundingHistory(symbol, limit, cursor);
      records = page.data;
      nextCursor = page.next_cursor;
      hasMore = page.has_more;
    }

    // Enrich each record
    const rates = records.map((r) => parseFloat(r.funding_rate));
    const m = mean(rates);
    const sd = stdDev(rates, m);

    const enriched = records.map((r, i) => {
      const fundingRateNum = rates[i];
      return {
        ...r,
        fundingRateNum,
        annualizedRate: toAnnualizedRate(fundingRateNum),
        historicalZScore: sd === 0 ? 0 : (fundingRateNum - m) / sd,
      };
    });

    const payload = {
      data: enriched,
      next_cursor: nextCursor,
      has_more: hasMore,
      count: enriched.length,
      windowStats: { mean: m, stdDev: sd },
    };

    cache.setStandard(cacheKey, payload);
    res.json({ success: true, ...payload });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/history/:symbol/zscore
 *
 * Returns only the historical z-score for the current live rate
 * relative to the last N hourly records.
 *
 * Query params:
 *   window – how many records to use (default 168 = 7 days)
 */
router.get('/:symbol/zscore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const window = Math.min(parseInt((req.query.window as string) ?? '168', 10), 4000);

    const cacheKey = `zscore:${symbol}:${window}`;
    const cached = cache.getStandard<unknown>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached });
      return;
    }

    const page = await fetchFundingHistory(symbol, window);
    const rates = page.data.map((r) => parseFloat(r.funding_rate));

    if (rates.length < 2) {
      res.json({ success: true, data: { symbol, zScore: 0, mean: 0, stdDev: 0, window: rates.length } });
      return;
    }

    const m = mean(rates);
    const sd = stdDev(rates, m);
    const latestRate = rates[0]; // most recent first
    const z = historicalZScore(latestRate, rates.slice(1));

    const result = { symbol, currentRate: latestRate, zScore: z, mean: m, stdDev: sd, window: rates.length };
    cache.setStandard(cacheKey, result);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
