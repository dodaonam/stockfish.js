const NATIVE_HOST_NAME = "com.lc0bot.nativehost";
const NATIVE_REQUEST_TIMEOUT_MS = 60_000;

let nativePort = null;
const pendingRequests = new Map();

function errorResponse(requestId, code, message) {
  return { ok: false, requestId, error: { code, message } };
}

function finishRequest(requestId, response) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pendingRequests.delete(requestId);
  pending.sendResponse(response);
}

function failPendingRequests(code, message) {
  for (const requestId of [...pendingRequests.keys()]) finishRequest(requestId, errorResponse(requestId, code, message));
}

function handleNativeMessage(message) {
  const requestId = typeof message?.requestId === "string" ? message.requestId : "";
  if (!requestId || !pendingRequests.has(requestId)) return;
  if (!message.ok) {
    finishRequest(requestId, errorResponse(requestId, message.code || "NATIVE_HOST_ERROR", message.message || "Native LC0 host failed"));
    return;
  }
  finishRequest(requestId, { ok: true, requestId, result: message });
}

function connectNativeHost() {
  if (nativePort) return nativePort;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    port.onMessage.addListener(handleNativeMessage);
    port.onDisconnect.addListener(() => {
      const details = chrome.runtime.lastError?.message || "Native LC0 host disconnected";
      if (nativePort === port) nativePort = null;
      failPendingRequests("NATIVE_HOST_DISCONNECTED", details);
    });
    nativePort = port;
    return port;
  } catch (_) {
    return null;
  }
}

function sendNativeRequest(payload, sendResponse) {
  const requestId = payload.requestId;
  if (!requestId || pendingRequests.has(requestId)) {
    sendResponse(errorResponse(requestId, "INVALID_REQUEST", "Invalid or duplicate request ID"));
    return false;
  }
  const port = connectNativeHost();
  if (!port) {
    sendResponse(errorResponse(requestId, "NATIVE_HOST_UNAVAILABLE", "LC0 Native Host is not installed or could not be started"));
    return false;
  }
  const timeoutId = setTimeout(() => finishRequest(requestId, errorResponse(requestId, "NATIVE_HOST_TIMEOUT", "Timed out waiting for LC0 Native Host")), NATIVE_REQUEST_TIMEOUT_MS);
  pendingRequests.set(requestId, { sendResponse, timeoutId });
  try {
    port.postMessage(payload);
  } catch (error) {
    finishRequest(requestId, errorResponse(requestId, "NATIVE_HOST_WRITE_FAILED", error instanceof Error ? error.message : "Could not send native request"));
  }
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return;
  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  if (message.type === "LC0_STATUS") return sendNativeRequest({ type: "PING", requestId }, sendResponse);
  if (message.type !== "LC0_BESTMOVE") return;
  const fen = typeof message.fen === "string" ? message.fen.trim() : "";
  const searchMode = message.searchMode === "nodes" ? "nodes" : "movetime";
  if (!requestId || !fen) {
    sendResponse(errorResponse(requestId, "INVALID_REQUEST", "Missing requestId or FEN"));
    return false;
  }

  if (searchMode === "nodes") {
    const nodes = Number(message.nodes);
    if (!Number.isInteger(nodes) || nodes < 1 || nodes > 10000) {
      sendResponse(errorResponse(requestId, "INVALID_REQUEST", "nodes must be an integer from 1 to 10000"));
      return false;
    }
    return sendNativeRequest({ type: "BESTMOVE", requestId, fen, searchMode, nodes }, sendResponse);
  }

  const movetimeSec = Number(message.movetimeSec);
  if (!Number.isFinite(movetimeSec)) {
    sendResponse(errorResponse(requestId, "INVALID_REQUEST", "movetimeSec must be a number"));
    return false;
  }
  return sendNativeRequest({ type: "BESTMOVE", requestId, fen, searchMode, movetimeMs: Math.round(Math.min(Math.max(movetimeSec, 0.001), 10) * 1000) }, sendResponse);
});
