import { h, icon, fill } from '../lib/dom.js';
import { stream } from '../lib/api.js';
import { renderInto } from '../lib/markdown.js';
import { loadingBlock } from './overview.js';

// Streams an AI response into `el` (used by summaries and "People also ask").
// Resolves with { text, sources } when finished.
export async function streamAnswer(el, { path, params, body, signal, stages = {}, onSources }) {
  const loader = loadingBlock(stages.initial || 'Thinking');
  const textEl = h('div', { class: 'md' });
  fill(el, loader.el);
  el.setAttribute('aria-busy', 'true');
  let text = '';
  let sources = [];
  let failed = null;
  let frame = 0;
  const paint = (streaming) => {
    frame = 0;
    renderInto(textEl, text, { sources, streaming });
  };
  try {
    await stream(path, {
      params,
      body,
      signal,
      onEvent(event, data) {
        if (event === 'status') loader.setStage(stages[data.stage] || 'Thinking');
        else if (event === 'sources') {
          sources = data;
          loader.setSources(data);
          onSources?.(data);
        } else if (event === 'token') {
          if (!text) fill(el, textEl);
          text += data.t;
          if (!frame) frame = requestAnimationFrame(() => paint(true));
        } else if (event === 'error') failed = data;
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    failed = { message: 'Spark AI is unreachable right now.' };
  }
  cancelAnimationFrame(frame);
  el.removeAttribute('aria-busy');
  if (failed && !text) {
    fill(el, h('div', { class: 'ai-error ai-error--inline' }, icon('alert'), h('p', {}, failed.message)));
    return { text: '', sources, error: failed };
  }
  paint(false);
  return { text, sources };
}
