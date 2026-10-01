// Talks to the "Spark Assistant for Chrome" extension, which lets the assistant work with
// your real Chrome tabs. In a normal Spark tab the extension's bridge script listens on this
// window; in the extension's side panel, Spark runs in a frame and the panel is the parent.

const CHANNEL = 'spark-ext';
let transport = null; // window (bridge) or window.parent (side panel)
let info = null;
let connecting = null;
const pending = new Map();
let seq = 0;

// Only the extension's side panel may act as the extension from a parent frame — not any
// site that happens to embed Spark.
const panelOrigin = (() => {
  const parent = window.parent !== window ? location.ancestorOrigins?.[0] : '';
  return parent && parent.startsWith('chrome-extension://') ? parent : '';
})();

function onMessage(e) {
  const m = e.data;
  if (!m || m.channel !== CHANNEL || m.dir !== 'to-page') return;
  const fromBridge = e.source === window && e.origin === location.origin;
  const fromPanel = Boolean(panelOrigin) && e.source === window.parent && e.origin === panelOrigin;
  if (!fromBridge && !fromPanel) return;
  if (m.type === 'ready') {
    transport ||= fromBridge ? window : window.parent;
    info ||= { version: m.version, unframe: Boolean(m.unframe), panel: Boolean(m.panel) };
  } else if (m.type === 'result' && pending.has(m.id)) {
    const { resolve, reject, timer } = pending.get(m.id);
    clearTimeout(timer);
    pending.delete(m.id);
    if (m.ok) resolve(m.result);
    else reject(new Error(m.error || 'The extension couldn’t do that.'));
  }
}

const post = (target, data, origin) => target.postMessage({ channel: CHANNEL, dir: 'to-ext', ...data }, origin);

// Resolves to { version, unframe, panel } when the extension is there, else null.
export function connectExtension({ wait = 600 } = {}) {
  connecting ||= new Promise((resolve) => {
    window.addEventListener('message', onMessage);
    post(window, { type: 'hello' }, location.origin);
    if (panelOrigin) post(window.parent, { type: 'hello' }, panelOrigin);
    const started = Date.now();
    const check = () => {
      if (info) return resolve(info);
      if (Date.now() - started > wait) return resolve(null);
      setTimeout(check, 40);
    };
    check();
  });
  return connecting;
}

export const extensionInfo = () => info;

export function extCall(method, args = {}, { timeout = 30000 } = {}) {
  if (!transport) return Promise.reject(new Error('The Spark Chrome extension isn’t connected.'));
  const id = `x${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The extension took too long to answer.'));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    post(transport, { type: 'call', id, method, args }, transport === window ? location.origin : panelOrigin);
  });
}
