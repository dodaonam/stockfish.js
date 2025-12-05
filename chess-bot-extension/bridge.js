chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_EXTENSION') {
    window.dispatchEvent(new CustomEvent('chess-bot-toggle', {
      detail: { enabled: message.enabled }
    }));
  }
});

chrome.storage.local.get(['extensionEnabled'], (result) => {
  window.dispatchEvent(new CustomEvent('chess-bot-toggle', {
    detail: { enabled: result.extensionEnabled !== false }
  }));
});
