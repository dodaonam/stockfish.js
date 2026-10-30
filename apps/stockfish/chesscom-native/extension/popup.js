const enableToggle = document.getElementById("enableToggle");
const hostStatus = document.getElementById("hostStatus");

function makeRequestId() {
  return `status-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

async function refreshHostStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "STF_STATUS", requestId: makeRequestId() });
    hostStatus.textContent = response?.ok
      ? "Local Stockfish host is ready."
      : `Local Stockfish host unavailable: ${response?.error?.message || "unknown error"}`;
  } catch (_) {
    hostStatus.textContent = "Local Stockfish host unavailable.";
  }
}

chrome.storage.local.get(["extensionEnabled"], (result) => {
  enableToggle.checked = result.extensionEnabled !== false;
});

refreshHostStatus();

enableToggle.addEventListener("change", () => {
  const enabled = enableToggle.checked;
  chrome.storage.local.set({ extensionEnabled: enabled }, () => {
    chrome.tabs.query({ url: ["*://www.chess.com/*"] }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab && typeof tab.id === "number") {
          chrome.tabs.sendMessage(tab.id, {
            type: "TOGGLE_EXTENSION",
            enabled
          }).catch(() => {});
        }
      });
    });
  });
});
