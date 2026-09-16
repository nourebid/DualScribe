import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verifySync } from "otplib";
import qrcode from "qrcode";
import crypto from "crypto";
import { groqTranscriptionMiddleware } from "./server/transcriptionRoute";

const db = new Database("sawtify.db");

// Initialize and migrate Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    gemini_api_key TEXT,
    mfa_enabled INTEGER DEFAULT 0,
    mfa_secret TEXT,
    mfa_backup_codes TEXT,
    reset_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT,
    language TEXT,
    result_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Safe incremental migrations for existing DB instances
try { db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN gemini_api_key TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN mfa_enabled INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN mfa_secret TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN mfa_backup_codes TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"); } catch {}

function maskApiKey(key?: string | null): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 6) + "••••••••" + key.slice(-4);
}

function generateBackupCodes(count = 6): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

function repairJson(jsonStr: string): any {
  let repaired = jsonStr.trim();
  repaired = repaired.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  
  try {
    return JSON.parse(repaired);
  } catch {
    const quotesMatch = repaired.match(/"/g) || [];
    const escapedQuotesMatch = repaired.match(/\\"/g) || [];
    const activeQuotes = quotesMatch.length - escapedQuotesMatch.length;
    if (activeQuotes % 2 !== 0) {
      repaired += '"';
    }

    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;

    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      repaired += "]";
    }
    for (let i = 0; i < openBraces - closeBraces; i++) {
      repaired += "}";
    }

    return JSON.parse(repaired);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", app: "DualScribe" });
  });

  // ----------------------------------------------------
  // AUTHENTICATION ROUTES (English-only, Real Secure Auth)
  // ----------------------------------------------------
  
  // Register
  app.post("/api/auth/register", (req, res) => {
    const { email, password } = req.body;
    
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(cleanEmail);
    if (existing) {
      return res.status(400).json({ error: "An account with this email already exists. Please log in." });
    }

    try {
      const hashedPassword = bcrypt.hashSync(password, 10);
      const stmt = db.prepare("INSERT INTO users (email, password_hash, mfa_enabled) VALUES (?, ?, 0)");
      const info = stmt.run(cleanEmail, hashedPassword);
      
      res.json({
        success: true,
        user: {
          id: info.lastInsertRowid,
          email: cleanEmail,
          hasApiKey: false,
          mfaEnabled: false,
          maskedApiKey: null,
        },
      });
    } catch (err: any) {
      console.error("Registration error:", err);
      res.status(500).json({ error: "Failed to create account. Please try again." });
    }
  });

  // Login (Supports MFA challenge)
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(cleanEmail) as any;
    
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Verify password hash
    let passwordValid = false;
    if (user.password_hash) {
      passwordValid = bcrypt.compareSync(password, user.password_hash);
    } else if (user.password) {
      // Legacy unhashed fallback -> upgrade immediately to hash
      if (user.password === password) {
        passwordValid = true;
        const newHash = bcrypt.hashSync(password, 10);
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);
      }
    }

    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Check Multi-Factor Authentication
    if (user.mfa_enabled === 1) {
      return res.json({
        requiresMfa: true,
        userId: user.id,
        email: user.email,
        message: "Multi-Factor Authentication code required.",
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        hasApiKey: !!user.gemini_api_key,
        maskedApiKey: maskApiKey(user.gemini_api_key),
        mfaEnabled: false,
      },
    });
  });

  // MFA Verification for Login
  app.post("/api/auth/mfa/verify-login", (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ error: "User ID and verification code are required." });
    }

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!user || !user.mfa_secret) {
      return res.status(400).json({ error: "MFA is not configured for this account." });
    }

    const cleanCode = String(code).trim().replace(/\s|-/g, "");

    // 1. Check standard TOTP 6-digit code
    const isTotpValid = verifySync({
      token: cleanCode,
      secret: user.mfa_secret,
    }).valid;

    if (isTotpValid) {
      return res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          hasApiKey: !!user.gemini_api_key,
          maskedApiKey: maskApiKey(user.gemini_api_key),
          mfaEnabled: true,
        },
      });
    }

    // 2. Check emergency backup recovery code
    let backupCodes: string[] = [];
    try {
      backupCodes = JSON.parse(user.mfa_backup_codes || "[]");
    } catch {}

    const formattedCode = cleanCode.length === 8 ? `${cleanCode.slice(0, 4)}-${cleanCode.slice(4)}` : cleanCode;
    const backupIndex = backupCodes.findIndex((b) => b.replace(/-/g, "").toUpperCase() === cleanCode.toUpperCase());

    if (backupIndex !== -1) {
      // Remove used backup code
      backupCodes.splice(backupIndex, 1);
      db.prepare("UPDATE users SET mfa_backup_codes = ? WHERE id = ?").run(JSON.stringify(backupCodes), user.id);

      return res.json({
        success: true,
        usedBackupCode: true,
        remainingBackupCodes: backupCodes.length,
        user: {
          id: user.id,
          email: user.email,
          hasApiKey: !!user.gemini_api_key,
          maskedApiKey: maskApiKey(user.gemini_api_key),
          mfaEnabled: true,
        },
      });
    }

    res.status(401).json({ error: "Invalid verification or backup code. Please try again." });
  });

  // MFA Setup: Generate Secret & QR Code
  app.post("/api/auth/mfa/setup", async (req, res) => {
    const { userId } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    try {
      const secret = generateSecret();
      const otpAuthUrl = generateURI({
        issuer: "DualScribe",
        label: user.email,
        secret,
      });
      const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);
      const backupCodes = generateBackupCodes(6);

      res.json({
        success: true,
        secret,
        qrCodeDataUrl,
        backupCodes,
      });
    } catch (err: any) {
      console.error("MFA setup error:", err);
      res.status(500).json({ error: "Failed to generate MFA setup keys." });
    }
  });

  // MFA Enable (Confirm with first 6-digit code)
  app.post("/api/auth/mfa/enable", (req, res) => {
    const { userId, secret, code, backupCodes } = req.body;
    if (!userId || !secret || !code) {
      return res.status(400).json({ error: "Missing required MFA confirmation parameters." });
    }

    const cleanCode = String(code).trim();
    const isValid = verifySync({ token: cleanCode, secret }).valid;
    if (!isValid) {
      return res.status(400).json({ error: "Invalid 6-digit verification code. Please check your authenticator app." });
    }

    try {
      db.prepare(
        "UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_backup_codes = ? WHERE id = ?"
      ).run(secret, JSON.stringify(backupCodes || []), userId);

      res.json({
        success: true,
        message: "Multi-Factor Authentication enabled successfully.",
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to enable MFA." });
    }
  });

  // MFA Disable
  app.post("/api/auth/mfa/disable", (req, res) => {
    const { userId, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    let passwordValid = false;
    if (user.password_hash) {
      passwordValid = bcrypt.compareSync(password, user.password_hash);
    } else if (user.password) {
      passwordValid = user.password === password;
    }

    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid password. Enter your current account password to disable MFA." });
    }

    try {
      db.prepare("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = ?").run(userId);
      res.json({ success: true, message: "MFA disabled successfully." });
    } catch (err) {
      res.status(500).json({ error: "Failed to disable MFA." });
    }
  });

  // Password Reset / Change
  app.post("/api/auth/reset-password", (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?").get(cleanEmail) as any;
    if (user) {
      const tempToken = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE users SET reset_token = ? WHERE id = ?").run(tempToken, user.id);
      res.json({
        success: true,
        message: `Password reset instructions ready for ${cleanEmail}. You can now proceed to set a new password.`,
        resetToken: tempToken,
        userId: user.id,
      });
    } else {
      res.status(404).json({ error: "No account found with this email address." });
    }
  });

  app.post("/api/auth/update-password", (req, res) => {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    try {
      const hash = bcrypt.hashSync(newPassword, 10);
      db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL WHERE id = ?").run(hash, userId);
      res.json({ success: true, message: "Password updated successfully. You can now log in." });
    } catch {
      res.status(500).json({ error: "Failed to update password." });
    }
  });

function normalizeModelName(name?: string): string {
  if (!name) return "gemini-3.8-flash";
  const trimmed = name.trim().toLowerCase();
  // Map non-existent, obsolete, or deprecated versions
  if (
    trimmed === "gemini-3.7-flash" ||
    trimmed === "gemini-3.6-flash" ||
    trimmed === "gemini-3.5-flash" ||
    trimmed === "gemini-2.0-flash" ||
    trimmed === "gemini-1.5-flash"
  ) {
    return "gemini-3.8-flash";
  }
  if (
    trimmed === "gemini-3.0-pro" ||
    trimmed === "gemini-2.5-pro" ||
    trimmed === "gemini-2.0-pro" ||
    trimmed === "gemini-1.5-pro"
  ) {
    return "gemini-3.1-pro-preview";
  }
  return trimmed;
}

function isTransientOrHighDemandError(err: any): boolean {
  if (!err) return false;
  const status = err?.status || err?.code || err?.statusCode || err?.error?.code;
  if (status === 503 || status === 429 || status === "UNAVAILABLE" || status === "RESOURCE_EXHAUSTED") {
    return true;
  }
  const msg = (typeof err === "string" ? err : err?.message || JSON.stringify(err)).toLowerCase();
  if (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("high demand") ||
    msg.includes("unavailable") ||
    msg.includes("temporarily") ||
    msg.includes("spikes in demand") ||
    msg.includes("resource exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded")
  ) {
    return true;
  }
  return false;
}

function detectAudioMimeType(base64Audio: string, fallbackMime?: string, filename?: string): string {
  let cleanMime = (fallbackMime || "").split(";")[0].trim().toLowerCase();

  // If filename provided, check extension first
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "mp3") cleanMime = "audio/mp3";
    else if (ext === "wav") cleanMime = "audio/wav";
    else if (ext === "m4a" || ext === "mp4") cleanMime = "audio/mp4";
    else if (ext === "aac") cleanMime = "audio/aac";
    else if (ext === "ogg" || ext === "opus") cleanMime = "audio/ogg";
    else if (ext === "flac") cleanMime = "audio/flac";
    else if (ext === "webm") cleanMime = "audio/webm";
  }

  // Deep inspect magic bytes of base64 data
  try {
    const head = Buffer.from(base64Audio.slice(0, 256), "base64");
    if (head.length >= 4) {
      // ID3v2 ('ID3') or MP3 sync frame (0xFF 0xEx)
      if (
        (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) ||
        (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
      ) {
        return "audio/mp3";
      }
      // RIFF....WAVE
      if (
        head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head.length >= 12 && head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45
      ) {
        return "audio/wav";
      }
      // OggS
      if (head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53) {
        return "audio/ogg";
      }
      // fLaC
      if (head[0] === 0x66 && head[1] === 0x4c && head[2] === 0x61 && head[3] === 0x43) {
        return "audio/flac";
      }
      // WebM / Matroska EBML
      if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
        return "audio/webm";
      }
      // MP4 / M4A: 'ftyp' in first 32 bytes
      for (let i = 0; i < Math.min(head.length - 4, 32); i++) {
        if (head[i] === 0x66 && head[i + 1] === 0x74 && head[i + 2] === 0x79 && head[i + 3] === 0x70) {
          return "audio/mp4";
        }
      }
      // AAC ADTS
      if (head[0] === 0xff && (head[1] === 0xf1 || head[1] === 0xf9)) {
        return "audio/aac";
      }
    }
  } catch (err) {
    console.warn("[DualScribe AI] Magic bytes inspection error:", err);
  }

  if (cleanMime.includes("wav")) return "audio/wav";
  if (cleanMime.includes("mpeg") || cleanMime.includes("mp3")) return "audio/mp3";
  if (cleanMime.includes("m4a") || cleanMime.includes("mp4")) return "audio/mp4";
  if (cleanMime.includes("ogg") || cleanMime.includes("opus")) return "audio/ogg";
  if (cleanMime.includes("flac")) return "audio/flac";
  if (cleanMime.includes("webm")) return "audio/webm";
  if (cleanMime.includes("aac")) return "audio/aac";

  return cleanMime || "audio/mp3";
}

function extractRawTextFromResponse(response: any): string {
  if (!response) return "";

  // 1. response.text
  try {
    if (typeof response.text === "string" && response.text.trim()) {
      return response.text.trim();
    }
  } catch (err) {
    console.warn("[DualScribe AI] response.text threw:", err);
  }

  // 2. output_text / outputText
  if (typeof response.outputText === "string" && response.outputText.trim()) {
    return response.outputText.trim();
  }
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  // 3. Candidates
  if (Array.isArray(response.candidates)) {
    for (const cand of response.candidates) {
      if (typeof cand?.outputText === "string" && cand.outputText.trim()) {
        return cand.outputText.trim();
      }
      if (typeof cand?.output_text === "string" && cand.output_text.trim()) {
        return cand.output_text.trim();
      }
      if (cand?.content?.parts && Array.isArray(cand.content.parts)) {
        const texts = cand.content.parts
          .map((p: any) => (typeof p?.text === "string" ? p.text : typeof p?.transcript === "string" ? p.transcript : ""))
          .filter(Boolean);
        if (texts.length > 0) {
          const joined = texts.join("\n").trim();
          if (joined) return joined;
        }
      }
      if (cand?.contentAnnotations || cand?.content_annotations) {
        const ann = cand.contentAnnotations || cand.content_annotations;
        if (typeof ann === "string" && ann.trim()) return ann.trim();
        if (typeof ann?.transcript === "string" && ann.transcript.trim()) return ann.transcript.trim();
      }
    }
  }

  return "";
}

function hasAudibleSpeech(result: { segments: { speaker: string; text: string }[]; fullText: string }): boolean {
  if (!result) return false;
  const combined = (result.fullText || result.segments?.map((s) => s.text).join(" ") || "").trim();
  if (!combined) return false;

  const lower = combined.toLowerCase();
  const emptyIndicators = [
    "no speech detected in audio file.",
    "no speech detected.",
    "no speech detected",
    "no speech",
    "[silence]",
    "[no speech]",
    "silence",
    "{}",
  ];
  return !emptyIndicators.includes(lower);
}

function isJsonModeError(err: any): boolean {
  if (!err) return false;
  const msg = (typeof err === "string" ? err : err?.message || JSON.stringify(err)).toLowerCase();
  return (
    msg.includes("json mode is not enabled") ||
    msg.includes("json mode") ||
    msg.includes("response_mime_type") ||
    msg.includes("responseschema")
  );
}

function modelSupportsJsonMode(model: string): boolean {
  const m = model.toLowerCase();
  // Dedicated speech-to-text models like gemini-3.5-transcribe output transcript text directly and do not support schema-based JSON mode
  if (m.includes("transcribe")) {
    return false;
  }
  return true;
}

function extractGeminiErrorMessage(err: any): string {
  if (!err) return "An unexpected error occurred.";
  if (typeof err === "string") {
    try {
      const parsed = JSON.parse(err);
      if (parsed?.error?.message) return parsed.error.message;
    } catch {}
    return err;
  }
  if (err?.message) {
    try {
      const parsed = JSON.parse(err.message);
      if (parsed?.error?.message) return parsed.error.message;
    } catch {}
    return err.message;
  }
  return "Transcription failed. Please try again.";
}

function detectLanguageFromText(text: string): string {
  if (!text) return "Egyptian Arabic / English";
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasEnglish = /[a-zA-Z]/.test(text);

  if (hasArabic && hasEnglish) {
    return "Egyptian Arabic / English";
  }
  if (hasArabic) {
    return "Egyptian Arabic";
  }
  return "English";
}

function parseTranscriptionResult(rawText: string, modelUsed: string): {
  language: string;
  segments: { speaker: string; text: string }[];
  fullText: string;
  modelUsed?: string;
} {
  const cleanRaw = (rawText || "").trim();

  // 1. Try structured JSON extraction first (in case model returned JSON directly or in code block)
  let parsedJson: any = null;
  const jsonMatch = cleanRaw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const potentialJson = jsonMatch ? jsonMatch[1].trim() : cleanRaw;

  try {
    parsedJson = JSON.parse(potentialJson);
  } catch {
    try {
      parsedJson = repairJson(potentialJson);
    } catch {}
  }

  if (
    parsedJson &&
    typeof parsedJson === "object" &&
    Array.isArray(parsedJson.segments) &&
    parsedJson.segments.length > 0
  ) {
    const validSegments = parsedJson.segments
      .filter((s: any) => s && (s.text || s.speaker))
      .map((s: any, idx: number) => ({
        speaker: typeof s.speaker === "string" && s.speaker.trim() ? s.speaker.trim() : `Speaker ${idx + 1}`,
        text: typeof s.text === "string" ? s.text.trim() : String(s.text || ""),
      }));

    return {
      language: parsedJson.language || detectLanguageFromText(cleanRaw),
      segments: validSegments.length > 0 ? validSegments : [{ speaker: "Speaker 1", text: cleanRaw }],
      fullText:
        parsedJson.fullText ||
        validSegments.map((s: any) => `${s.speaker}: ${s.text}`).join("\n") ||
        cleanRaw,
      modelUsed,
    };
  }

  // 2. Plain text parsing (e.g. from gemini-3.5-transcribe or models without JSON mode)
  const language = detectLanguageFromText(cleanRaw);
  const lines = cleanRaw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const segments: { speaker: string; text: string }[] = [];

  const speakerRegex = /^(?:\[[\d:]+\]\s*)?(Speaker\s+[\w\d]+|Person\s+[\w\d]+|متحدث\s*[\d]+|مستمع\s*[\d]+|Participant\s+[\w\d]+)\s*[:：\-]\s*(.*)$/i;

  let currentSpeaker = "Speaker 1";
  let currentBuffer: string[] = [];

  for (const line of lines) {
    const match = line.match(speakerRegex);
    if (match) {
      if (currentBuffer.length > 0) {
        segments.push({
          speaker: currentSpeaker,
          text: currentBuffer.join(" "),
        });
        currentBuffer = [];
      }
      currentSpeaker = match[1].trim();
      if (match[2].trim()) {
        currentBuffer.push(match[2].trim());
      }
    } else {
      currentBuffer.push(line);
    }
  }

  if (currentBuffer.length > 0) {
    segments.push({
      speaker: currentSpeaker,
      text: currentBuffer.join(" "),
    });
  }

  if (segments.length === 0) {
    if (cleanRaw) {
      segments.push({
        speaker: "Speaker 1",
        text: cleanRaw,
      });
    } else {
      segments.push({
        speaker: "Speaker 1",
        text: "No speech detected in audio file.",
      });
    }
  }

  return {
    language,
    segments,
    fullText: cleanRaw || "No speech detected in audio file.",
    modelUsed,
  };
}

async function generateTranscriptionWithRetry(
  ai: GoogleGenAI,
  primaryModel: string,
  base64Audio: string,
  normalizedMime: string,
  fallbackModels: string[] = []
): Promise<{ parsedResult: any; modelUsed: string }> {
  const modelsToTry: string[] = [];
  if (primaryModel) modelsToTry.push(primaryModel);
  for (const m of fallbackModels) {
    if (m && !modelsToTry.includes(m)) {
      modelsToTry.push(m);
    }
  }

  let lastError: any = null;
  let lastParsedResult: any = null;
  let lastModelUsed = primaryModel;

  const audioPart = {
    inlineData: {
      mimeType: normalizedMime,
      data: base64Audio,
    },
  };

  for (let mIndex = 0; mIndex < modelsToTry.length; mIndex++) {
    const currentModel = modelsToTry[mIndex];
    let supportsJson = modelSupportsJsonMode(currentModel);

    // Provide tailored prompt based on model capability
    let promptText: string;
    if (currentModel.toLowerCase().includes("transcribe")) {
      promptText = "Transcribe all audible speech in this audio recording accurately word-for-word. Identify distinct speakers as Speaker 1, Speaker 2.";
    } else {
      promptText = `You are a world-class speech-to-text transcription engine specializing in Egyptian Arabic, Arabic dialects, and English.
Please listen carefully to this entire audio recording from the very beginning to the end and transcribe all spoken speech verbatim:
1. Accurately transcribe Egyptian Arabic (العامية المصرية), Arabizi, slang, idioms, or Modern Standard Arabic (الفصحى), as well as English speech.
2. Capture all audible dialogue and spoken sentences even if there is background noise, music, sound effects, or low speaking volume.
3. Identify and label distinct speakers (e.g., "Speaker 1:", "Speaker 2:").
4. Return complete, faithful transcript segments without omitting or summarizing any spoken words.`;
    }

    const textPart = { text: promptText };

    // Pass audioPart first, then textPart per Gemini multimodal guidelines
    const baseContents = {
      parts: [audioPart, textPart],
    };

    const jsonSchemaConfig = {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          language: { type: "string", description: "Detected language and dialect" },
          segments: {
            type: "array",
            description: "List of speech segments by speaker",
            items: {
              type: "object",
              properties: {
                speaker: { type: "string", description: "Speaker identifier" },
                text: { type: "string", description: "Speech transcription text" },
              },
              required: ["speaker", "text"],
            },
          },
          fullText: { type: "string", description: "Complete transcript" },
        },
        required: ["language", "segments", "fullText"],
      },
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[DualScribe AI] Calling Gemini with model ${currentModel} (MIME: ${normalizedMime}, JSON config: ${supportsJson}, attempt ${attempt}/2)...`);

        const requestParams: any = {
          model: currentModel,
          contents: baseContents,
        };
        if (supportsJson) {
          requestParams.config = jsonSchemaConfig;
        }

        const response = await ai.models.generateContent(requestParams);
        const rawText = extractRawTextFromResponse(response);
        const parsed = parseTranscriptionResult(rawText, currentModel);

        lastParsedResult = parsed;
        lastModelUsed = currentModel;

        if (hasAudibleSpeech(parsed)) {
          console.log(`[DualScribe AI] Speech detected and transcribed successfully with model ${currentModel}. Turns: ${parsed.segments?.length || 0}`);
          return { parsedResult: parsed, modelUsed: currentModel };
        } else {
          console.warn(`[DualScribe AI] Model ${currentModel} returned no speech (raw length: ${rawText.length}).`);
          // If there are more models to try, break attempt loop and cascade to next model
          if (mIndex < modelsToTry.length - 1) {
            console.log(`[DualScribe AI] Cascading to next model ${modelsToTry[mIndex + 1]} for higher audio sensitivity...`);
            break;
          }
          // If this was the last model, return what we have
          return { parsedResult: parsed, modelUsed: currentModel };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[DualScribe AI] Model ${currentModel} attempt ${attempt} failed:`, err?.message || err);

        // If JSON mode is not supported on this model, retry immediately without JSON config
        if (supportsJson && isJsonModeError(err)) {
          console.warn(`[DualScribe AI] Model ${currentModel} reported JSON mode not enabled. Retrying immediately without JSON mode...`);
          supportsJson = false;
          attempt--;
          continue;
        }

        const isTransient = isTransientOrHighDemandError(err);
        if (!isTransient) {
          const isAuthError = err?.status === 401 || err?.status === 403 || String(err?.message || "").includes("API_KEY");
          if (isAuthError) {
            throw err;
          }
          break;
        }

        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 500));
        }
      }
    }
    console.warn(`[DualScribe AI] Model ${currentModel} exhausted. Trying next fallback model if available...`);
    if (mIndex < modelsToTry.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  if (lastParsedResult) {
    return { parsedResult: lastParsedResult, modelUsed: lastModelUsed };
  }

  throw lastError;
}

  // ----------------------------------------------------
  // USER API KEY MANAGEMENT (Bring Your Own Key - BYOK)
  // ----------------------------------------------------

  // Test and Save User's Personal Gemini API Key
  app.post("/api/user/api-key", async (req, res) => {
    const { userId, apiKey } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ error: "Please provide a valid Gemini API key." });
    }

    const cleanKey = apiKey.trim();

    // Verify key validity with Google Gemini API directly across candidate models to avoid 503 blockage
    const validationModels = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
    let validated = false;
    let lastTestErr: any = null;

    try {
      const testAi = new GoogleGenAI({
        apiKey: cleanKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      for (const testModel of validationModels) {
        try {
          await testAi.models.generateContent({
            model: testModel,
            contents: "Ping",
          });
          validated = true;
          break;
        } catch (testErr: any) {
          lastTestErr = testErr;
          // If it's an authentication/permission error (not transient 503/429), break immediately
          if (!isTransientOrHighDemandError(testErr)) {
            break;
          }
        }
      }
    } catch (clientInitErr: any) {
      lastTestErr = clientInitErr;
    }

    if (!validated) {
      console.error("Gemini API key verification failed:", lastTestErr);
      const isTransient = isTransientOrHighDemandError(lastTestErr);
      if (isTransient) {
        return res.status(503).json({
          code: "HIGH_DEMAND",
          error: "Google Gemini is currently experiencing temporary high demand across models. Your API key format appears valid, but Google's service is temporarily busy. Please try clicking Save again in a few seconds.",
        });
      }
      const errMsg = extractGeminiErrorMessage(lastTestErr);
      return res.status(400).json({
        error: `Could not validate API key with Google Gemini: ${errMsg}. Please verify your key from Google AI Studio.`,
      });
    }

    try {
      db.prepare("UPDATE users SET gemini_api_key = ? WHERE id = ?").run(cleanKey, userId);
      res.json({
        success: true,
        message: "Gemini API key verified and saved successfully.",
        hasApiKey: true,
        maskedApiKey: maskApiKey(cleanKey),
      });
    } catch (dbErr) {
      res.status(500).json({ error: "Failed to save API key to your profile." });
    }
  });

  // Delete User's API Key
  app.delete("/api/user/api-key/:userId", (req, res) => {
    const { userId } = req.params;
    try {
      db.prepare("UPDATE users SET gemini_api_key = NULL WHERE id = ?").run(userId);
      res.json({ success: true, message: "Gemini API key removed." });
    } catch {
      res.status(500).json({ error: "Failed to remove API key." });
    }
  });

  // Get User Profile & API Key Status
  app.get("/api/user/profile/:userId", (req, res) => {
    const { userId } = req.params;
    const user = db.prepare("SELECT id, email, gemini_api_key, mfa_enabled, created_at FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({
      id: user.id,
      email: user.email,
      hasApiKey: !!user.gemini_api_key,
      maskedApiKey: maskApiKey(user.gemini_api_key),
      mfaEnabled: !!user.mfa_enabled,
      createdAt: user.created_at,
    });
  });

  // ----------------------------------------------------
  // TRANSCRIPTION ROUTE (Using the User's Own API Key)
  // ----------------------------------------------------
  app.post("/api/transcribe", groqTranscriptionMiddleware, async (req, res) => {
    const { userId, base64Audio, mimeType, modelName, directApiKey, filename } = req.body;

    if (!base64Audio) {
      return res.status(400).json({ error: "Audio data is required for transcription." });
    }

    // Determine the user's API key
    let userApiKey: string | null = null;

    if (userId) {
      const user = db.prepare("SELECT gemini_api_key FROM users WHERE id = ?").get(userId) as any;
      if (user && user.gemini_api_key) {
        userApiKey = user.gemini_api_key;
      }
    }

    if (!userApiKey && directApiKey && typeof directApiKey === "string" && directApiKey.trim()) {
      userApiKey = directApiKey.trim();
    }

    // Strict BYOK enforcement: User MUST provide their own API key
    if (!userApiKey) {
      return res.status(403).json({
        code: "API_KEY_REQUIRED",
        error: "Gemini API Key Required: Each user must provide their personal Google Gemini API key to transcribe audio. Please configure your key in Settings or the API Key prompt.",
      });
    }

    try {
      const userAi = new GoogleGenAI({
        apiKey: userApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      const targetModel = normalizeModelName(modelName);

      // Detect and normalize audio container MIME type using magic bytes, extension, and client hint
      const normalizedMime = detectAudioMimeType(base64Audio, mimeType, filename);
      console.log(`[DualScribe AI] Starting transcription. Target model: ${targetModel}, detected MIME: ${normalizedMime}`);

      // Define ordered fallback models across distinct model families if primary model fails or is busy (503)
      const candidateFallbacks = [
        "gemini-3.8-flash",
        "gemini-3.5-transcribe",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
      ];
      const fallbacks = candidateFallbacks
        .map(normalizeModelName)
        .filter((m, idx, arr) => m !== targetModel && arr.indexOf(m) === idx);

      const { parsedResult } = await generateTranscriptionWithRetry(
        userAi,
        targetModel,
        base64Audio,
        normalizedMime,
        fallbacks
      );

      res.json(parsedResult);
    } catch (error: any) {
      console.error("Transcription error with user API key:", error);
      const isTransient = isTransientOrHighDemandError(error);
      const cleanMsg = extractGeminiErrorMessage(error);

      if (isTransient) {
        return res.status(503).json({
          code: "HIGH_DEMAND",
          isRetryable: true,
          error: "Google Gemini is currently experiencing temporary high demand for this model. Demand spikes are usually brief. Please try again in a few moments, or switch to an alternate model.",
        });
      }

      res.status(500).json({ error: `Transcription error: ${cleanMsg}` });
    }
  });

  // ----------------------------------------------------
  // TRANSCRIPTION HISTORY
  // ----------------------------------------------------
  app.post("/api/transcriptions", (req, res) => {
    const { userId, filename, language, result } = req.body;
    try {
      const stmt = db.prepare("INSERT INTO transcriptions (user_id, filename, language, result_json) VALUES (?, ?, ?, ?)");
      const info = stmt.run(userId, filename, language, JSON.stringify(result));
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ error: "Failed to save transcription history" });
    }
  });

  app.get("/api/transcriptions/:userId", (req, res) => {
    const { userId } = req.params;
    try {
      const rows = db.prepare("SELECT * FROM transcriptions WHERE user_id = ? ORDER BY created_at DESC").all(userId);
      res.json(rows.map((row: any) => ({
        ...row,
        result: JSON.parse(row.result_json),
      })));
    } catch (err) {
      res.status(500).json({ error: "Failed to load history" });
    }
  });

  app.delete("/api/transcriptions/record/:id", (req, res) => {
    const { id } = req.params;
    try {
      db.prepare("DELETE FROM transcriptions WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete record" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DualScribe server running on http://localhost:${PORT}`);
  });
}

startServer();
