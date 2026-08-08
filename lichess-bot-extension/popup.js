const enabled = document.getElementById('enabled');
chrome.storage.local.get({ enabled: true }).then(data => { enabled.checked = data.enabled; });
enabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabled.checked });
  const tabs = await chrome.tabs.query({ url: 'https://lichess.org/*' });
  await Promise.all(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_EXTENSION', enabled: enabled.checked }).catch(() => {})));
});
