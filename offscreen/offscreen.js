chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NAVIGATE_DECOY') {
    const frame = document.getElementById('decoy-frame');
    frame.src = message.url;
    sendResponse({ ok: true });
  } else if (message.type === 'CLOSE_DECOY') {
    const frame = document.getElementById('decoy-frame');
    frame.src = 'about:blank';
    sendResponse({ ok: true });
  }
});
