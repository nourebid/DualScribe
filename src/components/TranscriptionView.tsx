import React, { useState, useRef } from 'react';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
  FileDown,
  Download,
  Copy,
  Check,
  Languages,
  Sparkles,
  Search,
  Volume2,
  Edit2,
  Key,
  ExternalLink,
  RotateCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserData, TranscriptionResult, TranscriptionSegment } from '../types';
import { transcribeAudio } from '../services/gemini';
import { GROQ_MODEL, GROQ_MAX_AUDIO_BYTES, GROQ_EXTENSIONS } from '../transcriptionConfig';

interface TranscriptionViewProps {
  user: UserData;
  onOpenApiKeyModal: () => void;
  onTranscriptionSuccess: (filename: string, result: TranscriptionResult) => void;
  onExportPdf: (res: TranscriptionResult, filename: string) => void;
  onExportDocx: (res: TranscriptionResult, filename: string) => void;
  initialResult?: { filename: string; result: TranscriptionResult } | null;
}

export const TranscriptionView: React.FC<TranscriptionViewProps> = ({
  user,
  onOpenApiKeyModal,
  onTranscriptionSuccess,
  onExportPdf,
  onExportDocx,
  initialResult,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [groqApiKey, setGroqApiKey] = useState('');
  const isGroq = selectedModel === GROQ_MODEL;
  const [isDragging, setIsDragging] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<TranscriptionResult | null>(initialResult?.result || null);
  const [resultFilename, setResultFilename] = useState<string>(initialResult?.filename || '');
  const [error, setError] = useState<string | null>(null);
  const [isHighDemand, setIsHighDemand] = useState(false);
  const [activeTab, setActiveTab] = useState<'segments' | 'fulltext'>('segments');
  const [copied, setCopied] = useState(false);
  const [speakerFilter, setSpeakerFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (initialResult) {
      setResult(initialResult.result);
      setResultFilename(initialResult.filename);
    }
  }, [initialResult]);

  const validateAndSetFile = (selectedFile: File) => {
    if (
      selectedFile.type.startsWith('audio/') ||
      selectedFile.type === 'video/mp4' ||
      /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4)$/i.test(selectedFile.name)
    ) {
      setFile(selectedFile);
      setAudioUrl(URL.createObjectURL(selectedFile));
      setError(null);
      setResult(null);
      setResultFilename(selectedFile.name);
    } else {
      setError('Please upload a supported audio format (MP3, WAV, M4A, OGG, WebM, MP4).');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) validateAndSetFile(droppedFile);
  };

  const fileToBase64 = (f: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      setStatus('Encoding audio file...');
      setProgress(0);

      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setProgress(percent);
        }
      };

      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        setProgress(100);
        resolve(base64String);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(f);
    });
  };

  const handleTranscribe = async (overrideModel?: string) => {
    if (!file) return;

    const modelToUse = overrideModel || selectedModel;
    const useGroq = modelToUse === GROQ_MODEL;
    if (useGroq && (!groqApiKey.trim() || file.size > GROQ_MAX_AUDIO_BYTES || !GROQ_EXTENSIONS.test(file.name))) {
      setIsHighDemand(false);
      setError(!groqApiKey.trim() ? 'Enter your Groq API key below.' : file.size > GROQ_MAX_AUDIO_BYTES ? 'Groq supports files up to 25 MB. Compress or split this recording first.' : 'This format is not supported by Groq. Convert it to WAV, FLAC or MP3 first.');
      return;
    }

    // The saved key belongs exclusively to Gemini. Groq uses an in-memory key.
    if (!useGroq && !user.hasApiKey) {
      setError('Gemini API key required. Each user must connect their personal API key to transcribe audio.');
      setIsHighDemand(false);
      onOpenApiKeyModal();
      return;
    }

    if (overrideModel) {
      setSelectedModel(overrideModel);
    }

    setIsTranscribing(true);
    setError(null);
    setIsHighDemand(false);
    setProgress(0);
    setStatus('Preparing audio upload...');

    let progressInterval: number | null = null;

    try {
      const base64 = await fileToBase64(file);

      setStatus(`AI is analyzing audio & dialect with ${modelToUse}...`);
      setProgress(10);

      let simProgress = 10;
      progressInterval = window.setInterval(() => {
        if (simProgress < 90) {
          simProgress += Math.random() * 6;
        } else {
          simProgress += Math.random() * 0.4;
        }
        if (simProgress > 98) simProgress = 98;
        setProgress(Math.round(simProgress));

        if (simProgress > 30 && simProgress < 60) setStatus(useGroq ? 'Transcribing audio and timestamps...' : 'Detecting distinct speakers & timestamps...');
        if (simProgress >= 60) setStatus('Waiting for the completed transcript...');
      }, 700);

      // Normalize MIME type from file.type or file extension
      const ext = file.name.split('.').pop()?.toLowerCase();
      let detectedMime = (file.type || '').split(';')[0].trim();
      if (!detectedMime || detectedMime === 'application/octet-stream') {
        if (ext === 'mp3') detectedMime = 'audio/mp3';
        else if (ext === 'wav') detectedMime = 'audio/wav';
        else if (ext === 'm4a' || ext === 'mp4') detectedMime = 'audio/mp4';
        else if (ext === 'aac') detectedMime = 'audio/aac';
        else if (ext === 'ogg' || ext === 'opus') detectedMime = 'audio/ogg';
        else if (ext === 'flac') detectedMime = 'audio/flac';
        else if (ext === 'webm') detectedMime = 'audio/webm';
        else detectedMime = 'audio/mp3';
      }

      const transcription = await transcribeAudio(
        base64,
        detectedMime,
        modelToUse,
        user.id,
        useGroq ? groqApiKey.trim() : undefined,
        file.name,
        useGroq ? 'groq' : 'gemini'
      );

      if (progressInterval) clearInterval(progressInterval);
      setProgress(100);
      setStatus('Completed!');

      setResult(transcription);
      setResultFilename(file.name);
      onTranscriptionSuccess(file.name, transcription);
    } catch (err: any) {
      if (progressInterval) clearInterval(progressInterval);
      const errMsg = String(err?.message || '');
      const isDemandError =
        err.code === 'HIGH_DEMAND' ||
        err.isRetryable ||
        errMsg.includes('503') ||
        errMsg.toLowerCase().includes('high demand') ||
        errMsg.toLowerCase().includes('unavailable') ||
        errMsg.toLowerCase().includes('temporarily');

      if (useGroq) {
        setIsHighDemand(false);
        setError((err.message || 'Groq transcription failed.') + (err.retryAfter ? ` Retry after ${err.retryAfter} seconds.` : ''));
      } else if (err.code === 'API_KEY_REQUIRED') {
        setIsHighDemand(false);
        setError('Your Gemini API key is missing or expired. Please update your API key.');
        onOpenApiKeyModal();
      } else if (isDemandError) {
        setIsHighDemand(true);
        setError(err.message || 'Google Gemini is currently experiencing temporary high demand for this model. Demand spikes are usually brief and resolve quickly.');
      } else {
        setIsHighDemand(false);
        setError(err.message || 'An error occurred during audio transcription.');
      }
    } finally {
      setIsTranscribing(false);
    }
  };

  const copyTranscript = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Get distinct speaker names
  const speakers = Array.from(new Set(result?.segments?.map((s) => s.speaker) || []));

  const filteredSegments = result?.segments?.filter((seg) => {
    const matchesSpeaker = speakerFilter === 'all' || seg.speaker === speakerFilter;
    const matchesSearch = !searchTerm.trim() || seg.text.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSpeaker && matchesSearch;
  });

  return (
    <div className="space-y-8">
      {/* 1. API KEY BANNER IF NOT CONFIGURED */}
      {!isGroq && !user.hasApiKey && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 sm:p-5 bg-amber-50 border border-amber-200/90 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0 mt-0.5">
              <Key size={18} />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-950">Bring Your Own Key (BYOK) Required</p>
              <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                Connect your personal Google Gemini API key to unlock real-time bilingual transcription with zero developer markups.
              </p>
            </div>
          </div>
          <button
            onClick={onOpenApiKeyModal}
            className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors self-start sm:self-auto shrink-0 shadow-xs"
          >
            Connect Free API Key
          </button>
        </motion.div>
      )}

      {/* 2. UPLOAD BOX */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 shadow-xs border border-neutral-200/80">
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={`
            border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all
            ${isDragging ? 'border-neutral-900 bg-neutral-50 scale-[1.01]' : ''}
            ${file ? 'border-emerald-500 bg-emerald-50/40' : 'border-neutral-200 hover:border-neutral-400 hover:bg-neutral-50/60'}
          `}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) validateAndSetFile(selected);
            }}
            accept="audio/*,video/mp4"
            className="hidden"
          />

          {file ? (
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mb-3.5 shadow-xs">
                <CheckCircle2 size={28} />
              </div>
              <p className="font-bold text-base text-neutral-900 mb-1 max-w-md truncate">{file.name}</p>
              <p className="text-xs text-neutral-500 font-mono">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>

              {audioUrl && (
                <div className="mt-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                  <audio controls src={audioUrl} className="w-full h-10 rounded-lg" />
                </div>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setAudioUrl(null);
                  setResult(null);
                }}
                className="mt-3.5 text-xs text-red-600 hover:text-red-700 font-semibold hover:underline"
              >
                Remove selected file
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 bg-neutral-100 text-neutral-500 rounded-2xl flex items-center justify-center mb-3.5 shadow-xs">
                <Upload size={26} />
              </div>
              <p className="font-bold text-base text-neutral-900 mb-1">Click to upload or drag & drop audio</p>
              <p className="text-xs text-neutral-500">Supports MP3, WAV, M4A, OGG, WebM, and MP4</p>
            </div>
          )}
        </div>

        {file && (!result || !result.fullText?.trim() || result.fullText.toLowerCase().includes('no speech detected')) && !isTranscribing && (
          <div className="mt-6 space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-neutral-700" />
                  <span>Transcription Provider / Model</span>
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => { setSelectedModel(e.target.value); setError(null); setIsHighDemand(false); }}
                  className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs font-semibold text-neutral-800 outline-none focus:ring-2 focus:ring-neutral-900 cursor-pointer"
                >
                  <option value={GROQ_MODEL}>Groq · Whisper Large V3 Turbo</option>
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash (Fast & Accurate - Recommended)</option>
                  <option value="gemini-3.5-transcribe">Gemini 3.5 Transcribe (Audio Transcription Specialized)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (High Availability)</option>
                  <option value="gemini-flash-latest">Gemini Flash Latest (Auto-Managed)</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Deep Intelligence & Speaker Diarization)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                  <Languages size={14} className="text-neutral-700" />
                  <span>Dialect & Language Processing</span>
                </label>
                <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-700 font-medium flex items-center justify-between">
                  <span>Egyptian Arabic & English (Auto-detect)</span>
                  <span className="text-[10px] font-bold bg-neutral-200/80 px-2 py-0.5 rounded text-neutral-800">
                    Bilingual
                  </span>
                </div>
              </div>
            </div>

            {isGroq && (
              <div className="space-y-2">
                <label htmlFor="groq-api-key" className="block text-xs font-bold text-neutral-700">Groq API key (temporary)</label>
                <input id="groq-api-key" type="password" autoComplete="off" spellCheck={false}
                  value={groqApiKey} onChange={(e) => setGroqApiKey(e.target.value)}
                  placeholder="Enter your Groq API key"
                  className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs" />
                <p className="text-xs text-neutral-500">Kept in memory while this view is open; sent through the server to Groq. Up to 25 MB per file. Speaker identification is unavailable.</p>
                <a className="text-xs underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a Groq API key</a>
              </div>
            )}

            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => handleTranscribe(selectedModel)}
              className="w-full bg-neutral-900 text-white py-4 rounded-xl font-bold text-sm hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2 shadow-xs"
            >
              <Sparkles size={18} />
              <span>Transcribe Audio</span>
            </motion.button>
          </div>
        )}

        {isTranscribing && (
          <div className="mt-6 p-6 bg-neutral-50 border border-neutral-200/70 rounded-2xl space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Loader2 className="animate-spin text-neutral-900" size={22} />
                <p className="font-semibold text-xs text-neutral-800">{status}</p>
              </div>
              <span className="text-xs font-mono font-bold text-neutral-900">{progress}%</span>
            </div>

            <div className="w-full h-2.5 bg-neutral-200 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
                className="h-full bg-neutral-900 rounded-full"
              />
            </div>
            <p className="text-[11px] text-neutral-400 text-center italic">
              Processing conversational context, slang, and dialect nuances.
            </p>
          </div>
        )}

        {error && isHighDemand && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 p-5 bg-amber-50/90 border border-amber-200 rounded-2xl flex flex-col gap-3.5 text-xs shadow-xs"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle size={18} />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-amber-950 text-sm">Google Gemini High Demand (503)</h4>
                <p className="text-amber-800 leading-relaxed">
                  Google's servers are temporarily experiencing high demand on the requested model. Traffic spikes are usually brief. You can retry immediately or switch to an alternate model below.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/70">
              <button
                onClick={() => handleTranscribe(selectedModel)}
                className="px-4 py-2 bg-neutral-900 text-white rounded-xl font-bold flex items-center gap-1.5 hover:bg-neutral-800 transition-colors shadow-xs"
              >
                <RotateCw size={14} />
                <span>Retry Now</span>
              </button>

              {selectedModel !== 'gemini-3.5-transcribe' && (
                <button
                  onClick={() => handleTranscribe('gemini-3.5-transcribe')}
                  className="px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 rounded-xl font-semibold hover:bg-neutral-50 transition-colors"
                >
                  Try Gemini 3.5 Transcribe
                </button>
              )}

              {selectedModel !== 'gemini-3.1-flash-lite' && (
                <button
                  onClick={() => handleTranscribe('gemini-3.1-flash-lite')}
                  className="px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 rounded-xl font-semibold hover:bg-neutral-50 transition-colors"
                >
                  Try Gemini 3.1 Flash Lite
                </button>
              )}

              {selectedModel !== 'gemini-3.8-flash' && (
                <button
                  onClick={() => handleTranscribe('gemini-3.8-flash')}
                  className="px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 rounded-xl font-semibold hover:bg-neutral-50 transition-colors"
                >
                  Try with Gemini 3.8 Flash
                </button>
              )}

              {selectedModel !== 'gemini-flash-latest' && (
                <button
                  onClick={() => handleTranscribe('gemini-flash-latest')}
                  className="px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 rounded-xl font-semibold hover:bg-neutral-50 transition-colors"
                >
                  Try Gemini Flash Latest
                </button>
              )}
            </div>
          </motion.div>
        )}

        {error && !isHighDemand && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-red-700 text-xs font-medium"
          >
            <AlertCircle size={17} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>{error}</p>
              {!isGroq && !user.hasApiKey && (
                <button
                  onClick={onOpenApiKeyModal}
                  className="font-bold underline text-red-800 hover:text-red-900 block pt-0.5"
                >
                  Click here to connect your personal Gemini API key
                </button>
              )}
            </div>
          </motion.div>
        )}
      </section>

      {/* 3. TRANSCRIPT RESULTS SECTION */}
      <AnimatePresence>
        {result && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-white rounded-3xl shadow-xs border border-neutral-200/80 overflow-hidden"
          >
            {/* Header toolbar */}
            <div className="p-6 border-b border-neutral-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-900 flex items-center justify-center shrink-0">
                  <Users size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-sm text-neutral-900 truncate max-w-xs sm:max-w-md">
                    {resultFilename || 'Transcription Output'}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/70">
                      {result.language || 'Egyptian Arabic / English'}
                    </span>
                    {result.modelUsed && (
                      <span className="text-[10px] font-semibold text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200/80">
                        Model: {result.modelUsed}
                      </span>
                    )}
                    <span className="text-xs text-neutral-400 font-medium">
                      {result.segments?.length || 0} {result.speakerDiarization === false ? 'timed segments · speakers not identified' : 'speech turns'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl bg-neutral-100 p-1 border border-neutral-200/60">
                  <button
                    onClick={() => setActiveTab('segments')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeTab === 'segments' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    {result.speakerDiarization === false ? 'Segments' : 'Speaker View'}
                  </button>
                  <button
                    onClick={() => setActiveTab('fulltext')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeTab === 'fulltext' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    Full Text
                  </button>
                </div>

                <button
                  onClick={copyTranscript}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-semibold transition-colors border border-neutral-200/60"
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  onClick={() => onExportPdf(result, resultFilename || 'transcript')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-semibold transition-colors border border-neutral-200/60"
                  title="Export PDF"
                >
                  <FileDown size={14} />
                  <span>PDF</span>
                </button>

                <button
                  onClick={() => onExportDocx(result, resultFilename || 'transcript')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-semibold transition-colors shadow-xs"
                  title="Export Microsoft Word (.docx)"
                >
                  <Download size={14} />
                  <span>DOCX</span>
                </button>
              </div>
            </div>

            {/* Filter toolbar (when in segments mode) */}
            {activeTab === 'segments' && speakers.length > 1 && (
              <div className="px-6 py-3 bg-neutral-50/70 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                  <span className="font-semibold text-neutral-500 shrink-0">Filter Speaker:</span>
                  <button
                    onClick={() => setSpeakerFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-colors shrink-0 ${
                      speakerFilter === 'all'
                        ? 'bg-neutral-900 text-white'
                        : 'bg-neutral-200/70 text-neutral-700 hover:bg-neutral-300'
                    }`}
                  >
                    All ({result.segments?.length})
                  </button>
                  {speakers.map((spk) => (
                    <button
                      key={spk}
                      onClick={() => setSpeakerFilter(spk)}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition-colors shrink-0 ${
                        speakerFilter === spk
                          ? 'bg-neutral-900 text-white'
                          : 'bg-neutral-200/70 text-neutral-700 hover:bg-neutral-300'
                      }`}
                    >
                      {spk}
                    </button>
                  ))}
                </div>

                <div className="relative sm:w-56">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
                  <input
                    type="text"
                    placeholder="Search in transcript..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-neutral-900"
                  />
                </div>
              </div>
            )}

            {/* Content view */}
            <div className="p-6 sm:p-8 max-h-[600px] overflow-y-auto">
              {(!result.fullText?.trim() || result.fullText?.toLowerCase().includes('no speech detected')) ? (
                <div className="p-6 rounded-2xl bg-amber-50/80 border border-amber-200 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-200/80 text-amber-900 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertCircle size={18} />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-bold text-amber-950 text-sm">No Clear Speech Identified</h4>
                      <p className="text-xs text-amber-800 leading-relaxed">
                        The model did not pick up audible speech in this recording. If your audio has quiet dialogue, background music, or multiple sound layers, you can re-scan with specialized speech or high-sensitivity models below.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/70">
                    {result.speakerDiarization === false ? <p>Try another recording or choose a different provider above.</p> : <>
                    <button
                      onClick={() => handleTranscribe('gemini-3.8-flash')}
                      className="px-3.5 py-2 bg-neutral-900 text-white rounded-xl text-xs font-bold hover:bg-neutral-800 transition-colors flex items-center gap-1.5 shadow-xs"
                    >
                      <RotateCw size={13} />
                      <span>Re-scan with Gemini 3.8 Flash</span>
                    </button>
                    <button
                      onClick={() => handleTranscribe('gemini-3.5-transcribe')}
                      className="px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 rounded-xl text-xs font-semibold hover:bg-neutral-50 transition-colors"
                    >
                      Try with Gemini 3.5 Transcribe
                    </button>
                    <button
                      onClick={() => handleTranscribe('gemini-3.1-flash-lite')}
                      className="px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 rounded-xl text-xs font-semibold hover:bg-neutral-50 transition-colors"
                    >
                      Try Gemini 3.1 Flash Lite
                    </button>
                    <button
                      onClick={() => handleTranscribe('gemini-flash-latest')}
                      className="px-3.5 py-2 bg-white text-neutral-800 border border-neutral-200 rounded-xl text-xs font-semibold hover:bg-neutral-50 transition-colors"
                    >
                      Try Gemini Flash Latest
                    </button>
                    </>}
                  </div>
                </div>
              ) : activeTab === 'fulltext' ? (
                <div dir="auto" className="prose max-w-none text-neutral-800 text-base leading-relaxed whitespace-pre-wrap select-text">
                  {result.fullText}
                </div>
              ) : (
                <div className="space-y-6">
                  {filteredSegments && filteredSegments.length > 0 ? (
                    filteredSegments.map((segment, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-2xl bg-neutral-50/50 hover:bg-neutral-50 border border-neutral-200/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-neutral-900 bg-neutral-200/70 px-2.5 py-0.5 rounded-md">
                            {segment.speaker}
                          </span>
                          {segment.timestamp && <span className="text-xs text-neutral-500">{segment.timestamp}</span>}
                        </div>
                        <p className="text-neutral-800 text-base leading-relaxed select-text" dir="auto">
                          {segment.text}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-neutral-400 text-center py-8">No segments match your filter.</p>
                  )}
                </div>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};
