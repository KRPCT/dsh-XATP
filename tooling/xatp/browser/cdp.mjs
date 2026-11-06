/** Local Chromium transport. Each observation owns one page connection and a wall-clock budget. */
export class AdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}

export function localEndpoint(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AdapterError('invalid_endpoint', 'Use an HTTP loopback Chromium debugging endpoint.');
  }
  return url;
}

export async function targets(endpoint, signal) {
  let list;
  try {
    const response = await fetch(new URL('/json/list', endpoint), {signal, redirect:'error'});
    if (!response.ok) throw new Error();
    list = await response.json();
  } catch {
    throw new AdapterError('cdp_unavailable', 'Cannot read the local Chromium target list.');
  }
  if (!Array.isArray(list)) throw new AdapterError('cdp_unavailable', 'Invalid Chromium target list.');
  return list.filter(t => t.type === 'page' && typeof t.id === 'string' && typeof t.url === 'string');
}

export async function withPage(endpoint, target, signal, observe) {
  // Derive the socket address locally. A target listing cannot redirect the client.
  if (!/^[a-zA-Z0-9_-]+$/.test(target.id)) throw new AdapterError('invalid_target', 'Invalid Chromium target ID.');
  const url = new URL('/devtools/page/' + target.id, endpoint);
  url.protocol = 'ws:';
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  let opened;
  const connected = new Promise((resolve, reject) => { opened = {resolve, reject}; });
  const closed = () => {
    const error = new AdapterError('cdp_disconnected', 'Page connection ended. Refresh browser discovery.');
    opened.reject(error);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  socket.addEventListener('open', () => opened.resolve(), {once:true});
  socket.addEventListener('error', closed);
  socket.addEventListener('close', closed);
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.error) waiter.reject(new AdapterError('cdp_command_failed', 'Chromium rejected ' + waiter.method + '.'));
    else waiter.resolve(response.result);
  });
  signal.addEventListener('abort', closed, {once:true});
  function send(method, params = {}) {
    if (signal.aborted || socket.readyState !== WebSocket.OPEN) {
      throw new AdapterError('cdp_disconnected', 'Page connection ended. Refresh browser discovery.');
    }
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject, method});
      socket.send(JSON.stringify({id, method, params}));
    });
  }
  try {
    if (signal.aborted) closed();
    await connected;
    return await observe(send);
  } finally {
    signal.removeEventListener('abort', closed);
    socket.close();
  }
}
