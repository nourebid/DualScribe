import type { TranscriptionResult } from '../src/types.ts';
import { GROQ_MODEL, GROQ_MAX_AUDIO_BYTES, GROQ_EXTENSIONS } from '../src/transcriptionConfig.ts';

export class GroqError extends Error {
  status: number;
  code: string;
  isRetryable: boolean;
  retryAfter?: string;
  constructor(status: number, code: string, message: string, retryAfter?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.isRetryable = status === 429 || status >= 500;
    this.retryAfter = retryAfter;
  }
}

interface GroqInput {
  base64Audio?: unknown;
  mimeType?: unknown;
  filename?: unknown;
  directApiKey?: unknown;
}

export async function transcribeWithGroq(input: GroqInput, fetcher: typeof fetch = fetch): Promise<TranscriptionResult> {
  const { base64Audio, mimeType, filename, directApiKey } = input;
  if (typeof directApiKey !== 'string' || !directApiKey.trim()) {
    throw new GroqError(403, 'API_KEY_REQUIRED', 'Enter your Groq API key for this session.');
  }
  if (directApiKey.length > 512 || /[\r\n]/.test(directApiKey)) {
    throw new GroqError(400, 'INVALID_API_KEY', 'Invalid Groq API key.');
  }
  if (typeof base64Audio !== 'string' || !base64Audio.length) {
    throw new GroqError(400, 'INVALID_AUDIO', 'Audio data is required.');
  }
  // Bound before decoding; validate without a huge backtracking regular expression.
  if (base64Audio.length > 4 * Math.ceil(GROQ_MAX_AUDIO_BYTES / 3)) {
    throw new GroqError(413, 'FILE_TOO_LARGE', 'Groq uploads must be 25 MB or smaller. Compress or split this recording first.');
  }
  const audio = Buffer.from(base64Audio, 'base64');
  if (!audio.length || audio.toString('base64') !== base64Audio) {
    throw new GroqError(400, 'INVALID_AUDIO', 'Invalid base64 audio data.');
  }
  if (audio.length > GROQ_MAX_AUDIO_BYTES) {
    throw new GroqError(413, 'FILE_TOO_LARGE', 'Groq uploads must be 25 MB or smaller.');
  }
  const mime = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : '';
  const mimeExtensions: Record<string, string> = {
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'video/mp4': 'mp4', 'audio/ogg': 'ogg',
    'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/webm': 'webm', 'video/webm': 'webm',
  };
  const name = typeof filename === 'string' && filename ? filename : `audio.${mimeExtensions[mime] || 'unsupported'}`;
  if (!GROQ_EXTENSIONS.test(name) || mime === 'audio/aac') {
    throw new GroqError(415, 'UNSUPPORTED_AUDIO', 'Use FLAC, MP3, MP4, MPEG, MPGA, M4A, OGG, WAV or WebM. Convert raw AAC before uploading.');
  }
  const extension = name.split('.').pop()!.toLowerCase();
  const form = new FormData();
  // A fixed basename avoids passing personal filenames to the provider.
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime || 'application/octet-stream' }), `audio.${extension}`);
  form.append('model', GROQ_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('temperature', '0');
  // Leave language and prompt unset for mixed Arabic/English. A domain glossary
  // can be evaluated later; unrelated vocabulary may bias the transcript.

  try {
    const response = await fetcher('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${directApiKey.trim()}` },
      body: form, signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const status = response.status;
      const retry = response.headers.get('retry-after');
      const retryAfter = retry && /^\d+$/.test(retry) ? retry : undefined;
      // Never expose raw upstream bodies: they may contain request or credential details.
      await response.body?.cancel();
      if (status === 401 || status === 403) throw new GroqError(status, 'INVALID_API_KEY', 'Groq rejected this API key or its model permissions.');
      if (status === 429) throw new GroqError(429, 'RATE_LIMITED', 'Groq quota or rate limit reached. Wait before retrying; check your Groq account limits.', retryAfter);
      if (status === 413) throw new GroqError(413, 'FILE_TOO_LARGE', 'Groq rejected the upload size. Compress or split the recording.');
      if (status === 400 || status === 422) throw new GroqError(400, 'INVALID_AUDIO', 'Groq could not read this recording. Check its format or convert it to WAV or FLAC.');
      throw new GroqError(502, 'PROVIDER_UNAVAILABLE', 'Groq is unavailable. Please try again later.');
    }
    const data = await response.json();
    if (!data || typeof data.text !== 'string') throw new GroqError(502, 'INVALID_RESPONSE', 'Groq returned an invalid transcription response.');
    const text = data.text.trim();
    const segments = Array.isArray(data.segments) ? data.segments
      .filter((s: any) => typeof s?.text === 'string' && s.text.trim())
      .map((s: any) => {
        const seconds = Number.isFinite(s.start) && s.start >= 0 ? Math.floor(s.start) : null;
        const timestamp = seconds === null ? undefined : [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
        return { speaker: 'Speaker unknown', text: s.text.trim(), ...(timestamp ? { timestamp } : {}) };
      }) : [];
    if (!segments.length && text) segments.push({ speaker: 'Speaker unknown', text });
    const mixed = /[\u0600-\u06ff]/.test(text) && /[a-z]/i.test(text);
    return {
      fullText: text, segments, modelUsed: GROQ_MODEL, speakerDiarization: false,
      language: !text ? 'Unknown' : mixed ? 'Arabic / English' : typeof data.language === 'string' ? data.language : 'Unknown',
    };
  } catch (error) {
    if (error instanceof GroqError) throw error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new GroqError(504, 'PROVIDER_TIMEOUT', 'Groq took too long to respond. Try again or split the recording.');
    }
    throw new GroqError(502, 'PROVIDER_UNAVAILABLE', 'Could not read a response from Groq. Please try again later.');
  }
}
