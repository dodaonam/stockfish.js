(function () {
  'use strict';

  const SOURCE = '__LSC_EXTENSION_BRIDGE__';
  const installedKey = '__LSC_EXTENSION_BRIDGE_INSTALLED__';
  if (window[installedKey]) return;
  window[installedKey] = true;
  let contentReady = false;
  const pendingEvents = [];

  function parseMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), location.origin);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 3 && parts[0] === 'play' && /^v\d+$/.test(parts[2])) {
        // The round bootstrap endpoint uses /{gameId}; vN identifies the socket.
        const fullId = parts[1];
        return { kind: 'play', fullId, gameId: parts[1], url: url.href };
      }
    } catch (_) {}
    return null;
  }

  function emit(type, payload) {
    const event = { source: SOURCE, type, payload };
    if (!contentReady) {
      pendingEvents.push(event);
      return;
    }
    window.postMessage(event, location.origin);
  }

  window.addEventListener('lsc-extension-content-ready', () => {
    contentReady = true;
    for (const event of pendingEvents.splice(0)) window.postMessage(event, location.origin);
  }, { once: true });

  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) return;

  function WrappedWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    const meta = parseMeta(url);
    if (!meta) return socket;

    emit('ROUND_SOCKET_OPEN', meta);
    const originalSend = socket.send;
    socket.send = function (data) {
      try {
        if (typeof data === 'string') {
          const message = JSON.parse(data);
          if (message?.t) emit('ROUND_SOCKET_OUT', { meta, msg: message });
        }
      } catch (_) {}
      return originalSend.apply(this, arguments);
    };
    socket.addEventListener('message', event => {
      try {
        if (typeof event.data !== 'string' || event.data === '0') return;
        const message = JSON.parse(event.data);
        if (message?.t) emit('ROUND_SOCKET_IN', { meta, msg: message });
      } catch (_) {}
    });
    return socket;
  }

  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
  window.WebSocket = WrappedWebSocket;
  emit('BRIDGE_READY', { ok: true });
})();
