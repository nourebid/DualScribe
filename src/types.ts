export interface UserData {
  id: number;
  email: string;
  hasApiKey: boolean;
  maskedApiKey?: string | null;
  mfaEnabled: boolean;
  createdAt?: string;
}

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

export interface TranscriptionRecord {
  id: number;
  user_id: number;
  filename: string;
  language: string;
  result: TranscriptionResult;
  created_at: string;
}

export type View = 'login' | 'register' | 'forgot' | 'mfa-login' | 'app' | 'settings';
export type AppTab = 'transcribe' | 'history' | 'settings';
