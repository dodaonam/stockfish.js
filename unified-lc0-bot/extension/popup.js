"use strict";

const enableToggle = document.getElementById("enableToggle");
const hostStatus = document.getElementById("hostStatus");
const supportedPlatforms = {
  "www.chess.com": "chesscom",
  "lichess.org": "lichess"
};
let activePlatform = null;

function makeRequestId() {
  return `status-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

async function refreshHostStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "LC0_STATUS", requestId: makeRequestId() });
    hostStatus.textContent = response?.ok
      ? "Local LC0 host is ready."
      : `Local LC0 host unavailable: ${response?.error?.message || "unknown error"}`;
  } catch (_) {
    hostStatus.textContent = "Local LC0 host unavailable.";
  }
}

async function initializePopup() {
  enableToggle.disabled = true;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = null;
  try {
    hostname = new URL(activeTab?.url || "").hostname;
  } catch (_) {
    // Extensions can be opened on browser pages without a web URL.
  }
  activePlatform = supportedPlatforms[hostname] || null;

  if (activePlatform) {
    const key = `platform.${activePlatform}.extensionEnabled`;
    const stored = await chrome.storage.local.get([key]);
    enableToggle.checked = stored[key] !== false;
    enableToggle.disabled = false;
  }

  await refreshHostStatus();
  if (!activePlatform) {
    hostStatus.textContent += " Open Chess.com or Lichess to toggle the bot.";
  }
}

enableToggle.addEventListener("change", async () => {
  if (!activePlatform) return;
  const platform = activePlatform;
  const enabled = enableToggle.checked;
  const key = `platform.${platform}.extensionEnabled`;
  enableToggle.disabled = true;
  try {
    await chrome.storage.local.set({ [key]: enabled });
    const urls = platform === "lichess" ? ["*://lichess.org/*"] : ["*://www.chess.com/*"];
    const tabs = await chrome.tabs.query({ url: urls });
    await Promise.all(tabs.filter(tab => typeof tab.id === "number").map(tab =>
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_EXTENSION", platform, enabled }).catch(() => {})
    ));
  } catch (error) {
    enableToggle.checked = !enabled;
    hostStatus.textContent = `Unable to save extension setting: ${error?.message || "unknown error"}`;
  } finally {
    enableToggle.disabled = false;
  }
});

initializePopup().catch(error => {
  hostStatus.textContent = `Popup initialization failed: ${error?.message || "unknown error"}`;
});
