export interface TranscriptionSegment {
  speaker: string;
  text: string;
  timestamp?: string;
}

export interface TranscriptionResult {
  language: string;
  segments: TranscriptionSegment[];
  fullText: string;
  modelUsed?: string;
}

export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
  modelName: string = "gemini-3.8-flash",
  userId?: number,
  directApiKey?: string,
  filename?: string
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
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const error: any = new Error(data.error || "Failed to transcribe audio. Please try again.");
    if (data.code) {
      error.code = data.code;
    }
    if (data.isRetryable) {
      error.isRetryable = data.isRetryable;
    }
    throw error;
  }

  return data as TranscriptionResult;
}

