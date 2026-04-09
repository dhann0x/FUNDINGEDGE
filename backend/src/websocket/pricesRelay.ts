import { IncomingMessage, Server } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from '../lib/config';
import { enrichMarkets } from '../lib/statistics';
import { cache } from '../lib/cache';
import { MarketPrice, MarketWithStats } from '../types/pacifica';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

interface ClientMessage {
  op: 'subscribe' | 'unsubscribe' | 'ping';
  channel?: string;
}

type BroadcastChannel = 'prices' | 'extremes';

const CACHE_KEY_PRICES = 'prices:all';

// ─────────────────────────────────────────────────────────────
//  Relay class
//
//  Maintains ONE upstream connection to Pacifica and fans the
//  messages out to ALL connected frontend clients.  This means
//  we don't open a new Pacifica socket for every browser tab.
// ─────────────────────────────────────────────────────────────

export class PricesRelay {
  private wss: WebSocketServer;
  private upstream: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;

  /** clients subscribed to each channel */
  private subscribers: Map<BroadcastChannel, Set<WebSocket>> = new Map([
    ['prices', new Set()],
    ['extremes', new Set()],
  ]);

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', this.handleClientConnection.bind(this));
    this.connectUpstream();
  }

  // ── Upstream (Pacifica) connection ──────────────────────────

  private connectUpstream(): void {
    const headers: Record<string, string> = {};
    if (config.pacifica.apiKey) {
      headers['PF-API-KEY'] = config.pacifica.apiKey;
    }

    console.log(`[WS] Connecting to Pacifica: ${config.pacifica.wsUrl}`);
    this.upstream = new WebSocket(config.pacifica.wsUrl, { headers });

    this.upstream.on('open', () => {
      console.log('[WS] Upstream connected');
      this.isConnected = true;

      // Subscribe to prices channel
      this.upstream!.send(JSON.stringify({ op: 'subscribe', channel: 'prices' }));

      // Keep-alive ping every 30 s
      this.pingInterval = setInterval(() => {
        if (this.upstream?.readyState === WebSocket.OPEN) {
          this.upstream.send(JSON.stringify({ op: 'ping' }));
        }
      }, 30_000);
    });

    this.upstream.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.channel === 'prices' && Array.isArray(msg.data)) {
          this.handlePricesUpdate(msg.data as MarketPrice[]);
        }
      } catch {
        // ignore malformed frames
      }
    });

    this.upstream.on('close', () => {
      console.warn('[WS] Upstream disconnected – reconnecting in 3 s');
      this.isConnected = false;
      this.clearPing();
      this.reconnectTimeout = setTimeout(() => this.connectUpstream(), 3_000);
    });

    this.upstream.on('error', (err) => {
      console.error('[WS] Upstream error:', err.message);
    });
  }

  private clearPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ── Incoming prices from Pacifica ────────────────────────────

  private handlePricesUpdate(raw: MarketPrice[]): void {
    const enriched = enrichMarkets(raw);
    cache.setPrices(CACHE_KEY_PRICES, enriched);

    // Broadcast to all clients subscribed to "prices"
    this.broadcast('prices', {
      channel: 'prices',
      data: enriched,
      timestamp: Date.now(),
    });

    // Broadcast extremes separately so the frontend can subscribe
    // to just the signal without processing every market
    const extremes = enriched.filter((m) => m.isExtreme);
    if (extremes.length > 0) {
      this.broadcast('extremes', {
        channel: 'extremes',
        data: extremes,
        count: extremes.length,
        timestamp: Date.now(),
      });
    }
  }

  // ── Client connection handling ────────────────────────────────

  private handleClientConnection(ws: WebSocket, _req: IncomingMessage): void {
    console.log('[WS] Client connected');

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        this.handleClientMessage(ws, msg);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      this.unsubscribeAll(ws);
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
      this.unsubscribeAll(ws);
    });

    // Send current state immediately so the client doesn't wait up to 5 s
    const cached = cache.getPrices<MarketWithStats[]>(CACHE_KEY_PRICES);
    if (cached) {
      ws.send(JSON.stringify({ channel: 'prices', data: cached, timestamp: Date.now() }));
    }

    // Acknowledge connection
    ws.send(JSON.stringify({ op: 'connected', upstreamConnected: this.isConnected }));
  }

  private handleClientMessage(ws: WebSocket, msg: ClientMessage): void {
    if (msg.op === 'ping') {
      ws.send(JSON.stringify({ op: 'pong' }));
      return;
    }

    const channel = msg.channel as BroadcastChannel | undefined;
    if (!channel || !this.subscribers.has(channel)) {
      ws.send(JSON.stringify({ error: `Unknown channel: ${channel}` }));
      return;
    }

    if (msg.op === 'subscribe') {
      this.subscribers.get(channel)!.add(ws);
      ws.send(JSON.stringify({ op: 'subscribed', channel }));
    } else if (msg.op === 'unsubscribe') {
      this.subscribers.get(channel)!.delete(ws);
      ws.send(JSON.stringify({ op: 'unsubscribed', channel }));
    }
  }

  private unsubscribeAll(ws: WebSocket): void {
    this.subscribers.forEach((set) => set.delete(ws));
  }

  // ── Broadcasting ──────────────────────────────────────────────

  private broadcast(channel: BroadcastChannel, payload: unknown): void {
    const clients = this.subscribers.get(channel);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify(payload);
    clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  // ── Status ────────────────────────────────────────────────────

  get connected(): boolean {
    return this.isConnected;
  }

  get clientCount(): number {
    let total = 0;
    this.subscribers.forEach((set) => (total += set.size));
    return total;
  }
}

let relay: PricesRelay | null = null;

export function initRelay(server: Server): PricesRelay {
  relay = new PricesRelay(server);
  return relay;
}

export function getRelay(): PricesRelay | null {
  return relay;
}
