import { Router, Request, Response, NextFunction } from 'express';
import { fetchPositions, fetchAccountFundingHistory } from '../lib/pacificaClient';
import { toAnnualizedRate } from '../lib/statistics';
import { cache } from '../lib/cache';

const router = Router();

// ─────────────────────────────────────────────────────────────
//  Address validation
// ─────────────────────────────────────────────────────────────

function isValidAddress(address: string): boolean {
  // Accept standard hex addresses (with or without 0x prefix) and base58-style
  return /^(0x)?[0-9a-fA-F]{40,64}$/.test(address);
}

/**
 * GET /api/v1/account/:address/positions
 *
 * Returns open positions for a wallet address, enriched with:
 *   sideLabel         – "Long" | "Short"
 *   entryPriceNum     – parseFloat(entry_price)
 *   amountNum         – parseFloat(amount)
 *   cumulativeFunding – parseFloat(funding)
 *   projectedDailyCost – estimated daily funding $ at current rates (placeholder)
 */
router.get('/:address/positions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      res.status(400).json({ success: false, error: 'Invalid wallet address format' });
      return;
    }

    const cacheKey = `account:${address}:positions`;
    const cached = cache.getStandard<unknown[]>(cacheKey);
    if (cached) {
      res.json({ success: true, data: cached, count: cached.length });
      return;
    }

    const positions = await fetchPositions(address);

    const enriched = positions.map((p) => ({
      ...p,
      sideLabel: p.side === 'bid' ? 'Long' : 'Short',
      entryPriceNum: parseFloat(p.entry_price),
      amountNum: parseFloat(p.amount),
      cumulativeFunding: parseFloat(p.funding),
    }));

    cache.setStandard(cacheKey, enriched);
    res.json({ success: true, data: enriched, count: enriched.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/account/:address/funding
 *
 * Returns the full funding payment history for a wallet, enriched with:
 *   payoutNum         – parseFloat(payout)
 *   sideLabel         – "Long" | "Short"
 *   cumulativeTotal   – running cumulative sum of payouts (chronological order)
 *   annualizedRate    – rate * 24 * 365 * 100
 */
router.get('/:address/funding', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      res.status(400).json({ success: false, error: 'Invalid wallet address format' });
      return;
    }

    const cacheKey = `account:${address}:funding`;
    const cached = cache.getStandard<unknown>(cacheKey);
    if (cached) {
      res.json({ success: true, ...cached });
      return;
    }

    const history = await fetchAccountFundingHistory(address);

    // Sort ascending by created_at so cumulative sum makes sense
    const sorted = [...history].sort((a, b) => a.created_at - b.created_at);
    let cumulative = 0;

    const enriched = sorted.map((record) => {
      const payoutNum = parseFloat(record.payout);
      cumulative += payoutNum;
      return {
        ...record,
        payoutNum,
        sideLabel: record.side === 'bid' ? 'Long' : 'Short',
        cumulativeTotal: cumulative,
        annualizedRate: toAnnualizedRate(parseFloat(record.rate)),
      };
    });

    const totalReceived = enriched
      .filter((r) => r.payoutNum > 0)
      .reduce((sum, r) => sum + r.payoutNum, 0);
    const totalPaid = enriched
      .filter((r) => r.payoutNum < 0)
      .reduce((sum, r) => sum + r.payoutNum, 0);

    const payload = {
      data: enriched,
      count: enriched.length,
      summary: {
        totalReceived,
        totalPaid,
        netFunding: cumulative,
      },
    };

    cache.setStandard(cacheKey, payload);
    res.json({ success: true, ...payload });
  } catch (err) {
    next(err);
  }
});

export default router;
