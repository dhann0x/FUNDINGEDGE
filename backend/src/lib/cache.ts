import NodeCache from 'node-cache';

/**
 * Tiered in-memory cache.
 * Each tier has its own TTL so we don't have to pass TTL on every `set` call.
 *
 * Tiers:
 *   prices   – 5s   (live funding rates)
 *   standard – 30s  (history, account data)
 *   long     – 60s  (market specs, sentiment)
 */
class TieredCache {
  private prices: NodeCache;
  private standard: NodeCache;
  private long: NodeCache;

  constructor(
    pricesTtl: number,
    standardTtl: number,
    longTtl: number,
  ) {
    this.prices = new NodeCache({ stdTTL: pricesTtl, checkperiod: pricesTtl });
    this.standard = new NodeCache({ stdTTL: standardTtl, checkperiod: standardTtl });
    this.long = new NodeCache({ stdTTL: longTtl, checkperiod: longTtl });
  }

  getPrices<T>(key: string): T | undefined {
    return this.prices.get<T>(key);
  }
  setPrices<T>(key: string, value: T): void {
    this.prices.set(key, value);
  }

  getStandard<T>(key: string): T | undefined {
    return this.standard.get<T>(key);
  }
  setStandard<T>(key: string, value: T): void {
    this.standard.set(key, value);
  }

  getLong<T>(key: string): T | undefined {
    return this.long.get<T>(key);
  }
  setLong<T>(key: string, value: T): void {
    this.long.set(key, value);
  }

  /** Bust a key from all tiers */
  del(key: string): void {
    this.prices.del(key);
    this.standard.del(key);
    this.long.del(key);
  }

  stats() {
    const p = this.prices.getStats();
    const s = this.standard.getStats();
    const l = this.long.getStats();
    return {
      keys: p.keys + s.keys + l.keys,
      hits: p.hits + s.hits + l.hits,
      misses: p.misses + s.misses + l.misses,
    };
  }
}

import { config } from './config';

export const cache = new TieredCache(
  config.cache.pricesTtl,
  config.cache.historyTtl,
  config.cache.marketInfoTtl,
);
