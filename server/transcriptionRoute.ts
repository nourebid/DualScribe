import type { RequestHandler } from 'express';
import { GroqError, transcribeWithGroq } from './groq';

// Missing provider preserves the original Gemini contract. Never cross-provider fallback.
export const groqTranscriptionMiddleware: RequestHandler = async (req, res, next) => {
  const provider = req.body?.provider ?? 'gemini';
  if (provider === 'gemini') { next(); return; }
  if (provider !== 'groq') {
    res.status(400).json({ error: 'Unsupported transcription provider.', code: 'INVALID_PROVIDER' });
    return;
  }
  try {
    res.json(await transcribeWithGroq(req.body));
  } catch (error) {
    const safe = error instanceof GroqError ? error : new GroqError(500, 'TRANSCRIPTION_FAILED', 'Transcription failed.');
    if (safe.retryAfter) res.setHeader('Retry-After', safe.retryAfter);
    res.status(safe.status).json({ error: safe.message, code: safe.code, isRetryable: safe.isRetryable, retryAfter: safe.retryAfter });
  }
};
