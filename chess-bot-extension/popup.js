const enableToggle = document.getElementById('enableToggle');

chrome.storage.local.get(['extensionEnabled'], (result) => {
  enableToggle.checked = result.extensionEnabled !== false;
});

enableToggle.addEventListener('change', () => {
  const enabled = enableToggle.checked;
  chrome.storage.local.set({ extensionEnabled: enabled }, () => {
    // Notify content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && tabs[0].url.includes('chess.com')) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          type: 'TOGGLE_EXTENSION', 
          enabled: enabled 
        }).catch(() => {});
      }
    });
  });
});
