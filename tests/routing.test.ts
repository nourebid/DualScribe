import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { groqTranscriptionMiddleware } from '../server/transcriptionRoute';

// Exercise the real HTTP contract; sentinel represents the unchanged Gemini handler.
test('routes old clients to Gemini, rejects unknown providers, and never falls back for Groq', async () => {
  const app = express();
  app.use(express.json());
  let geminiCalls = 0;
  app.post('/api/transcribe', groqTranscriptionMiddleware, (_req, res) => {
    geminiCalls++;
    res.json({ legacyGemini: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const send = (body: object) => fetch(`http://127.0.0.1:${address.port}/api/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await (await send({})).json(), { legacyGemini: true });
    assert.deepEqual(await (await send({ provider: 'gemini' })).json(), { legacyGemini: true });
    const bad = await send({ provider: 'unknown' });
    assert.equal(bad.status, 400);
    const groq = await send({ provider: 'groq', userId: 1 });
    assert.equal(groq.status, 403);
    assert.equal((await groq.json()).code, 'API_KEY_REQUIRED');
    assert.equal(geminiCalls, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});
