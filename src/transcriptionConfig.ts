export const GROQ_MODEL = 'whisper-large-v3-turbo';
// Decimal MB, conservatively below providers that interpret MB as MiB.
export const GROQ_MAX_AUDIO_BYTES = 25_000_000;
export const GROQ_EXTENSIONS = /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i;
export type TranscriptionProvider = 'gemini' | 'groq';
