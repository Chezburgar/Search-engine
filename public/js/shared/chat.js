// Shared chat handling for the server and the static build: validates history
// (including image attachments) and builds OpenAI-style messages for the model.

export const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 6_000_000; // ~4.5 MB of image data per attachment
const DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const validImage = (s) => typeof s === 'string' && s.length <= MAX_IMAGE_CHARS && DATA_URL.test(s);

// Client format: { role: 'user' | 'assistant', content: string, images?: string[] }.
// Only the most recent MAX_IMAGES images are kept; models accept a handful at most.
export function sanitizeHistory(raw) {
  const history = (Array.isArray(raw) ? raw : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 6000),
      images: m.role === 'user' && Array.isArray(m.images) ? m.images.filter(validImage) : [],
    }));
  let budget = MAX_IMAGES;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.images.length > budget) {
      m.content = `${m.content}\n[${m.images.length - budget} earlier image(s) omitted]`.trim();
      m.images = m.images.slice(0, budget);
    }
    budget -= m.images.length;
  }
  return history;
}

export const validChat = (history) => {
  const last = history[history.length - 1];
  return Boolean(last && last.role === 'user' && (last.content.trim() || last.images.length));
};

// "What's in this picture?" needs the image, not a web search. Questions with real
// subject matter ("is this plant safe for cats?") still get fresh sources.
export function shouldSearch(last) {
  if (!last.images.length) return true;
  const text = last.content.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 4) return false;
  return !(words < 9 && /\b(this|these|that|it|image|picture|photo|pic|screenshot)\b/i.test(text));
}

const userContent = (text, images) =>
  images.length
    ? [
        { type: 'text', text: text || "What's in this image?" },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : text;

// `lastText` is the final user message with web sources appended.
export function toModelMessages(system, history, lastText) {
  const last = history[history.length - 1];
  return [
    { role: 'system', content: system },
    ...history
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.role === 'user' ? userContent(m.content, m.images) : m.content })),
    { role: 'user', content: userContent(lastText, last.images) },
  ];
}
