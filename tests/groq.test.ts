import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribeWithGroq } from '../server/groq.ts';

const input = { base64Audio: Buffer.from('RIFFtestWAVEaudio').toString('base64'), mimeType: 'audio/wav', filename: 'meeting.wav', directApiKey: 'test-secret' };
const success = { text: 'إحنا نراجع recruitment pipeline tomorrow.', language: 'arabic', segments: [{ start: 65.2, text: 'إحنا نراجع recruitment pipeline tomorrow.' }] };

test('preserves bilingual text and timestamps without inventing speakers; sends multipart to transcription only', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
    const form = init?.body as FormData;
    assert.equal(form.get('model'), 'whisper-large-v3-turbo');
    assert.equal(form.get('language'), null);
    assert.equal(form.get('response_format'), 'verbose_json');
    assert.equal(form.get('timestamp_granularities[]'), 'segment');
    assert.deepEqual(Buffer.from(await (form.get('file') as Blob).arrayBuffer()), Buffer.from(input.base64Audio, 'base64'));
    return Response.json(success);
  };
  const result = await transcribeWithGroq(input, fetcher);
  assert.equal(result.fullText, success.text);
  assert.equal(result.language, 'Arabic / English');
  assert.equal(result.speakerDiarization, false);
  assert.deepEqual(result.segments, [{ speaker: 'Speaker unknown', text: success.text, timestamp: '00:01:05' }]);
});

test('rejects missing key, invalid base64, unsupported AAC and oversized files before upload', async () => {
  const noNetwork: typeof fetch = async () => { assert.fail('invalid input must not be uploaded'); };
  for (const [patch, status] of [
    [{ directApiKey: '' }, 403],
    [{ base64Audio: 'not base64!' }, 400],
    [{ base64Audio: '' }, 400],
    [{ mimeType: 'audio/aac', filename: 'meeting.aac' }, 415],
    [{ base64Audio: Buffer.alloc(25_000_001).toString('base64') }, 413],
  ] as const) {
    await assert.rejects(transcribeWithGroq({ ...input, ...patch }, noNetwork), (e: any) => e.status === status);
  }
});

test('preserves rate-limit status and retry-after without leaking upstream bodies or retrying', async () => {
  let calls = 0;
  await assert.rejects(transcribeWithGroq(input, async () => {
    calls++;
    return new Response('test-secret upstream detail', { status: 429, headers: { 'Retry-After': '17' } });
  }), (e: any) => e.status === 429 && e.retryAfter === '17' && e.isRetryable && !e.message.includes('test-secret'));
  assert.equal(calls, 1);
});

test('maps authentication, upstream failure, timeout and malformed responses safely', async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(transcribeWithGroq(input, async () => new Response('secret', { status })), (e: any) => e.status === (status === 500 ? 502 : status));
  }
  await assert.rejects(transcribeWithGroq(input, async () => { throw new DOMException('secret', 'TimeoutError'); }), (e: any) => e.status === 504);
  await assert.rejects(transcribeWithGroq(input, async () => Response.json({ text: 123 })), (e: any) => e.status === 502);
});

test('handles empty speech and text-only responses without fake dialect or speakers', async () => {
  const empty = await transcribeWithGroq(input, async () => Response.json({ text: '', segments: [] }));
  assert.equal(empty.fullText, '');
  assert.deepEqual(empty.segments, []);
  assert.equal(empty.language, 'Unknown');
  const plain = await transcribeWithGroq(input, async () => Response.json({ text: 'hello', language: 'english' }));
  assert.deepEqual(plain.segments, [{ speaker: 'Speaker unknown', text: 'hello' }]);
});
