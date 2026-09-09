import React, { useState } from 'react';
import { Key, ExternalLink, Check, AlertCircle, Loader2, X, Eye, EyeOff, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ApiKeyModalProps {
  userId: number;
  isOpen: boolean;
  onClose: () => void;
  currentMaskedKey?: string | null;
  onSuccess: (newMaskedKey: string | null) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  userId,
  isOpen,
  onClose,
  currentMaskedKey,
  onSuccess,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSaveAndValidate = async () => {
    if (!apiKeyInput.trim()) {
      setStatusMessage({ type: 'error', text: 'Please enter your Google Gemini API key.' });
      return;
    }

    setIsValidating(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/user/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          apiKey: apiKeyInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to validate API key.');
      }

      setStatusMessage({ type: 'success', text: 'API key verified and connected successfully!' });
      onSuccess(data.maskedApiKey);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Verification failed.' });
    } finally {
      setIsValidating(false);
    }
  };

  const handleDeleteKey = async () => {
    setIsDeleting(true);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/user/api-key/${userId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove API key.');

      onSuccess(null);
      setApiKeyInput('');
      setStatusMessage({ type: 'success', text: 'API key removed successfully.' });
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-neutral-200 overflow-hidden relative max-h-[90vh] overflow-y-auto"
      >
        <button
          onClick={onClose}
          className="absolute right-5 top-5 p-2 text-neutral-400 hover:text-neutral-900 rounded-full hover:bg-neutral-100 transition-colors"
        >
          <X size={20} />
        </button>

        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shrink-0">
              <Key size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-neutral-900">Google Gemini API Key</h3>
              <p className="text-xs text-neutral-500">Each user connects their own key for LLM transcription.</p>
            </div>
          </div>

          <div className="p-4 bg-neutral-50 border border-neutral-200/80 rounded-2xl space-y-3">
            <div className="flex items-start gap-2">
              <div className="text-xs text-neutral-700 leading-relaxed">
                <span className="font-semibold">Bring Your Own Key (BYOK):</span> DualScribe connects directly to Google's Gemini models using your personal key. This ensures maximum privacy, direct access to your quota, and zero usage markups.
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between">
              <span className="text-xs text-neutral-500 font-medium">Don't have an API key yet?</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-900 bg-white hover:bg-neutral-100 px-3 py-1.5 rounded-lg border border-neutral-200 shadow-xs transition-colors"
              >
                <span>Get Free Gemini Key</span>
                <ExternalLink size={13} />
              </a>
            </div>
          </div>

          {currentMaskedKey && (
            <div className="flex items-center justify-between p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-xl">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-emerald-950">Active Key Connected</p>
                  <p className="text-xs font-mono text-emerald-800 font-bold">{currentMaskedKey}</p>
                </div>
              </div>
              <button
                onClick={handleDeleteKey}
                disabled={isDeleting}
                className="text-xs text-red-600 hover:text-red-700 font-medium hover:bg-red-100/60 p-2 rounded-lg transition-colors flex items-center gap-1"
                title="Remove API Key"
              >
                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                <span>Remove</span>
              </button>
            </div>
          )}

          <div className="space-y-3">
            <label className="block text-xs font-semibold text-neutral-700">
              {currentMaskedKey ? 'Replace API Key:' : 'Enter your Gemini API Key:'}
            </label>

            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder="AIzaSy..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full pl-4 pr-11 py-3 bg-neutral-50 border border-neutral-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-neutral-900 focus:bg-white outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg transition-colors"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-[11px] text-neutral-400 italic">
              Your API key is securely encrypted and stored specifically under your user account in the database.
            </p>
          </div>

          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs font-medium ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border-red-200 text-red-600'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <Check size={16} className="shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          <div className="flex gap-2.5 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold text-xs rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAndValidate}
              disabled={isValidating || !apiKeyInput.trim()}
              className="flex-1 py-3 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isValidating ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              <span>{isValidating ? 'Validating Key...' : 'Validate & Save Key'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
