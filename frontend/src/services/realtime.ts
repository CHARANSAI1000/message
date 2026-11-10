/** WebSocket to the server: instant "sync" nudges and relayed (end-to-end encrypted) call signals. */

type Handler = (event: Record<string, unknown>) => void;

export class Realtime {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private retry = 0;
  private timer: number | undefined;
  private pinger: number | undefined;
  private closed = false;
  connected = false;

  constructor(private onStatus: (connected: boolean) => void = () => undefined) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      this.handlers.get('open')?.forEach((h) => h({ type: 'open' }));  // re-subscribe after reconnects
      this.pinger = window.setInterval(() => this.send({ type: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(String(e.data)) as Record<string, unknown>;
        this.handlers.get(String(event.type))?.forEach((h) => h(event));
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      window.clearInterval(this.pinger);
      this.setConnected(false);
      if (this.closed) return;
      const delay = Math.min(30000, 1000 * 2 ** this.retry++) * (0.75 + Math.random() / 2);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private setConnected(v: boolean) {
    this.connected = v;
    this.onStatus(v);
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  send(event: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(event));
    return true;
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    window.clearInterval(this.pinger);
    this.ws?.close();
  }
}
