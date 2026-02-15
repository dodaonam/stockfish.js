const enableToggle = document.getElementById('enableToggle');

chrome.storage.local.get(['extensionEnabled'], (result) => {
  enableToggle.checked = result.extensionEnabled !== false;
});

enableToggle.addEventListener('change', () => {
  const enabled = enableToggle.checked;
  chrome.storage.local.set({ extensionEnabled: enabled }, () => {
    chrome.tabs.query({ url: ['*://www.chess.com/*'] }, (tabs) => {
      tabs.forEach((tab) => {
        if (tab && typeof tab.id === 'number') {
          chrome.tabs.sendMessage(tab.id, {
            type: 'TOGGLE_EXTENSION',
            enabled
          }).catch(() => {});
        }
      });
    });
  });
});
