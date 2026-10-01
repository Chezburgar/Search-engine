// The side panel shows Spark's assistant (your Spark site, in assistant-only mode) and relays
// its tab requests to the background worker, the same way the bridge does in a Spark tab.

const CHANNEL = 'spark-ext';
const frame = document.getElementById('spark');
const gear = document.querySelector('.gear');
const panel = document.getElementById('settings');
const unframe = document.getElementById('unframe');
const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('spark-url');
const status = document.getElementById('status');

const ask = (msg) =>
  chrome.runtime.sendMessage(msg).then((r) => {
    if (!r?.ok) throw new Error(r?.error || 'The extension didn’t answer.');
    return r.result;
  });

let sparkOrigin = '';

function load(settings) {
  const base = settings.sparkUrl;
  sparkOrigin = new URL(base).origin;
  urlInput.value = base;
  unframe.checked = settings.unframe;
  const src = `${base}?page=assistant`;
  if (frame.src !== src) frame.src = src;
}

ask({ type: 'spark-settings' }).then(load, (err) => (status.textContent = err.message));

gear.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  gear.setAttribute('aria-expanded', String(!panel.hidden));
});

unframe.addEventListener('change', async () => {
  const settings = await ask({ type: 'spark-settings', set: { unframe: unframe.checked } });
  status.textContent = settings.unframe
    ? 'Sites can now show inside Spark tabs. Reload open Spark tabs to apply.'
    : 'Sites decide again whether they can show inside Spark tabs.';
});

urlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    load(await ask({ type: 'spark-settings', set: { sparkUrl: urlInput.value } }));
    status.textContent = 'Saved. Reload any open Spark tabs.';
  } catch (err) {
    status.textContent = err.message;
  }
});

const reply = (data) => frame.contentWindow?.postMessage({ channel: CHANNEL, dir: 'to-page', ...data }, sparkOrigin);

window.addEventListener('message', async (e) => {
  if (e.source !== frame.contentWindow || e.origin !== sparkOrigin) return;
  const m = e.data;
  if (!m || m.channel !== CHANNEL || m.dir !== 'to-ext') return;
  if (m.type === 'hello') {
    const settings = await ask({ type: 'spark-settings' }).catch(() => ({}));
    reply({ type: 'ready', version: chrome.runtime.getManifest().version, unframe: settings.unframe, panel: true });
  } else if (m.type === 'call' && typeof m.id === 'string') {
    try {
      const result = await ask({ type: 'spark-tool', method: m.method, args: m.args });
      reply({ type: 'result', id: m.id, ok: true, result });
    } catch (err) {
      reply({ type: 'result', id: m.id, ok: false, error: err.message });
    }
  }
});
