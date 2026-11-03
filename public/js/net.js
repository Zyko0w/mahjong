// Client WebSocket pour le mode duel.
export class DuelClient {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.queue = [];
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws`));
    ws.onopen = () => {
      this.onStatus('open');
      for (const m of this.queue) ws.send(m);
      this.queue = [];
    };
    ws.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    ws.onclose = () => { this.onStatus('closed'); this.ws = null; };
    ws.onerror = () => this.onStatus('error');
  }

  send(msg) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) this.ws.send(data);
    else {
      this.queue.push(data);
      this.connect();
    }
  }
}
