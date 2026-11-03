// Client WebSocket pour le mode duel.
// Par défaut, le serveur de duel est le site lui-même (/ws). En production sur Vercel, il est
// hébergé ailleurs (Railway, Render…) et son adresse vient de window.MJ_CONFIG.duelServer (config.js).
export function duelUrl() {
  let url = ((window.MJ_CONFIG && window.MJ_CONFIG.duelServer) || '').trim();
  if (!url) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }
  url = url.replace(/^http(s?):\/\//i, 'ws$1://');
  if (!/^wss?:\/\//i.test(url)) url = 'wss://' + url;
  if (!/\/ws\/?$/.test(new URL(url).pathname)) url = url.replace(/\/+$/, '') + '/ws';
  return url;
}

export class DuelClient {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.queue = [];
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    let ws;
    try {
      ws = this.ws = new WebSocket(duelUrl());
    } catch {
      this.onStatus('error');
      return;
    }
    ws.onopen = () => {
      this.onStatus('open');
      for (const m of this.queue) ws.send(m);
      this.queue = [];
    };
    ws.onmessage = (e) => {
      try { this.onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    ws.onclose = () => { this.queue = []; this.ws = null; this.onStatus('closed'); };
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
