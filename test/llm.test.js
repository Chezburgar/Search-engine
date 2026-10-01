// The shared AI client against mocked Groq and xAI APIs.
process.env.MOCK_DELAY = '0';
const { mockFetch, calls } = await import('./fixtures/mock-fetch.js');
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { createLLM } = await import('../public/js/shared/llm.js');

globalThis.fetch = mockFetch;
const IMAGE = 'data:image/jpeg;base64,/9j/AAAA';
const read = async (gen) => {
  let text = '';
  for await (const t of gen) text += t;
  return text;
};
const lastBody = (host) => JSON.parse(calls.filter((c) => c.url.includes(host) && c.method === 'POST').at(-1).body);

test('Groq: text uses the best available model with short reasoning', async () => {
  const llm = createLLM({ provider: 'groq', apiKey: 'gsk_test' });
  assert.equal(await llm.resolveModel(), 'openai/gpt-oss-120b');
  const text = await read(llm.streamChat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 }));
  assert.match(text, /How stars become black holes/);
  const body = lastBody('api.groq.com');
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_tokens, 900, 'reasoning models get extra token budget');
  assert.equal(calls.find((c) => c.url.includes('api.groq.com')).url, 'https://api.groq.com/openai/v1/models');
});

test('Groq: images go to the vision model and inline thinking is removed', async () => {
  const llm = createLLM({ provider: 'groq', apiKey: 'gsk_test' });
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: IMAGE } },
      ],
    },
  ];
  const text = await read(llm.streamChat({ messages, kind: 'chat' }));
  assert.match(text, /^The image shows/);
  assert.doesNotMatch(text, /think|carefully/);
  const body = lastBody('api.groq.com');
  assert.equal(body.model, 'qwen/qwen3.6-27b');
  assert.equal(body.reasoning_format, 'hidden');
});

test('Groq: built-in web search and browsing', async () => {
  const llm = createLLM({ provider: 'groq', apiKey: 'gsk_test' });
  const results = await llm.webSearch('black holes');
  assert.equal(results.length, 5);
  assert.equal(results[0].url, 'https://science.nasa.gov/universe/black-holes/');
  assert.match(results[0].content, /More on black holes/);
  assert.equal(lastBody('api.groq.com').model, 'groq/compound-mini');
  assert.match(await llm.askWithTools('Visit https://example.com and summarize'), /TL;DR/);
});

test('xAI has no built-in search; status reports the provider', async () => {
  const llm = createLLM({ provider: 'xai', apiKey: 'xai-test' });
  assert.deepEqual(await llm.webSearch('x'), []);
  const status = await llm.status();
  assert.equal(status.provider, 'Grok');
  assert.equal(status.model, 'grok-4-1-fast-non-reasoning');
  assert.equal((await createLLM({}).status()).enabled, false);
});
