chrome.runtime.onInstalled.addListener(() => {
  console.info('Lichess Stockfish Coach installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ENGINE_FETCH') return undefined;

  fetch(message.url, { cache: 'no-cache' })
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${message.url}`);
      if (message.responseType === 'arraybuffer') {
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        sendResponse({ ok: true, data: btoa(binary) });
        return;
      }
      sendResponse({ ok: true, data: await response.text() });
    })
    .catch(error => sendResponse({ ok: false, error: error.message }));

  return true;
});
