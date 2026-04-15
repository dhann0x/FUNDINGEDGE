import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from './config';
import {
  PacificaEnvelope,
  MarketPrice,
  FundingHistoryResponse,
  FundingPayment,
  Position,
  MarketInfo,
} from '../types/pacifica';

// ─────────────────────────────────────────────────────────────
//  Axios instance – all outbound calls to Pacifica go through here
// ─────────────────────────────────────────────────────────────

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

if (config.pacifica.apiKey) {
  headers['PF-API-KEY'] = config.pacifica.apiKey;
}

const http: AxiosInstance = axios.create({
  baseURL: config.pacifica.restUrl,
  timeout: 10_000,
  headers,
});

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function unwrap<T>(envelope: PacificaEnvelope<T>): T {
  if (!envelope.success) {
    throw new Error(`Pacifica API error: ${envelope.error ?? 'unknown'}`);
  }
  return envelope.data;
}

async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  try {
    const res = await http.get<PacificaEnvelope<T>>(path, { params });
    return unwrap(res.data);
  } catch (err) {
    if (err instanceof AxiosError) {
      const msg = err.response?.data?.error ?? err.message;
      throw new Error(`Pacifica request failed [${err.response?.status}]: ${msg}`);
    }
    throw err;
  }
}

/**
 * Like get() but returns the full top-level response object without unwrapping.
 * Used for paginated endpoints where next_cursor / has_more sit alongside data.
 */
async function getRaw<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  try {
    const res = await http.get<T>(path, { params });
    return res.data;
  } catch (err) {
    if (err instanceof AxiosError) {
      const msg = err.response?.data?.error ?? err.message;
      throw new Error(`Pacifica request failed [${err.response?.status}]: ${msg}`);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
//  Public API surface
// ─────────────────────────────────────────────────────────────

/** GET /info/prices – live mark price + funding for ALL markets */
export async function fetchAllPrices(): Promise<MarketPrice[]> {
  return get<MarketPrice[]>('/info/prices');
}

/**
 * GET /funding_rate/history – historical funding for ONE market.
 * @param symbol  e.g. "BTC"
 * @param limit   max records (default 100, max 4000)
 * @param cursor  pagination cursor from previous response
 */
export async function fetchFundingHistory(
  symbol: string,
  limit = 200,
  cursor?: string,
): Promise<FundingHistoryResponse> {
  const params: Record<string, unknown> = { symbol, limit };
  if (cursor) params.cursor = cursor;

  // The Pacifica history endpoint returns pagination fields (next_cursor, has_more)
  // at the top level alongside data — not nested inside data — so we use getRaw
  // instead of get() to avoid unwrap() discarding those fields.
  const raw = await getRaw<{
    success: boolean;
    data: FundingHistoryRecord[] | null;
    next_cursor: string | null;
    has_more: boolean;
    error?: string | null;
  }>('/funding_rate/history', params);

  if (!raw.success) {
    throw new Error(`Pacifica API error: ${raw.error ?? 'unknown'}`);
  }

  return {
    data: raw.data ?? [],
    next_cursor: raw.next_cursor,
    has_more: raw.has_more,
  };
}

/**
 * Fetch multiple pages of funding history up to `maxRecords`.
 * Returns the flattened list of records.
 */
export async function fetchFundingHistoryAll(
  symbol: string,
  maxRecords = 4000,
): Promise<FundingHistoryResponse['data']> {
  const records: FundingHistoryResponse['data'] = [];
  let cursor: string | undefined;
  let remaining = maxRecords;

  do {
    const batch = Math.min(remaining, 500);
    const page = await fetchFundingHistory(symbol, batch, cursor);
    records.push(...page.data);
    remaining -= page.data.length;
    cursor = page.next_cursor ?? undefined;

    if (!page.has_more || !cursor) break;
  } while (remaining > 0);

  return records;
}

/**
 * GET /funding/history – actual funding payments for a wallet address.
 * @param account  wallet address (hex)
 */
export async function fetchAccountFundingHistory(account: string): Promise<FundingPayment[]> {
  return get<FundingPayment[]>('/funding/history', { account });
}

/**
 * GET /positions – open positions for a wallet address.
 * @param account  wallet address (hex)
 */
export async function fetchPositions(account: string): Promise<Position[]> {
  return get<Position[]>('/positions', { account });
}

/**
 * GET /info – all tradeable market specifications.
 * Cache this for 60 s; it changes rarely.
 */
export async function fetchMarketInfo(): Promise<MarketInfo[]> {
  return get<MarketInfo[]>('/info');
}
