import type { TranscriptionResult } from '../types';
import type { TranscriptionProvider } from '../transcriptionConfig';
export type { TranscriptionResult, TranscriptionSegment } from '../types';

export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
  modelName: string = "gemini-3.8-flash",
  userId?: number,
  directApiKey?: string,
  filename?: string,
  provider: TranscriptionProvider = "gemini"
): Promise<TranscriptionResult> {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Audio,
      mimeType,
      modelName,
      userId,
      directApiKey,
      filename,
      provider,
    }),
  });

  const data = await response.json().catch(() => ({ error: `Upload failed (HTTP ${response.status}). Check the file size and connection.` }));

  if (!response.ok) {
    const error: any = new Error(data.error || "Failed to transcribe audio. Please try again.");
    if (data.code) {
      error.code = data.code;
    }
    error.retryAfter = data.retryAfter;
    if (data.isRetryable) {
      error.isRetryable = data.isRetryable;
    }
    throw error;
  }

  return data as TranscriptionResult;
}

