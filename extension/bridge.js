// Runs only on your Spark site (see registerBridge in background.js). Tells Spark the
// extension is installed and relays the assistant's tab requests to the extension.
(() => {
  const CHANNEL = 'spark-ext';
  const send = (data) => window.postMessage({ channel: CHANNEL, dir: 'to-page', ...data }, location.origin);

  let hello = null;
  const connect = () =>
    (hello ||= chrome.runtime
      .sendMessage({ type: 'spark-hello' })
      .then((r) => (r?.ok ? r.result : null))
      .catch(() => null));

  connect().then((info) => {
    if (!info) return;
    document.documentElement.dataset.sparkExtension = info.version;
    send({ type: 'ready', ...info });
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.channel !== CHANNEL || m.dir !== 'to-ext') return;
    if (m.type === 'hello') {
      connect().then((info) => info && send({ type: 'ready', ...info }));
    } else if (m.type === 'call' && typeof m.id === 'string' && typeof m.method === 'string') {
      chrome.runtime
        .sendMessage({ type: 'spark-tool', method: m.method, args: m.args })
        .then((r) => send({ type: 'result', id: m.id, ok: Boolean(r?.ok), result: r?.result, error: r?.error }))
        .catch((err) =>
          send({ type: 'result', id: m.id, ok: false, error: err?.message || 'The extension didn’t answer.' })
        );
    }
  });
})();
