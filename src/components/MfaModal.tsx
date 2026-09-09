import React, { useState } from 'react';
import { Shield, Check, Copy, AlertCircle, Loader2, X, Download, KeyRound } from 'lucide-react';
import { motion } from 'motion/react';

interface MfaModalProps {
  userId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const MfaModal: React.FC<MfaModalProps> = ({
  userId,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'loading' | 'setup' | 'backup' | 'disable'>('loading');
  const [secret, setSecret] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      startMfaSetup();
    }
  }, [isOpen]);

  const startMfaSetup = async () => {
    setStep('loading');
    setError(null);
    setVerifyCode('');
    try {
      const res = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start MFA setup');

      setSecret(data.secret);
      setQrCodeDataUrl(data.qrCodeDataUrl);
      setBackupCodes(data.backupCodes || []);
      setStep('setup');
    } catch (err: any) {
      setError(err.message);
      setStep('setup');
    }
  };

  const handleVerifyAndEnable = async () => {
    if (!verifyCode || verifyCode.trim().length < 6) {
      setError('Please enter the 6-digit verification code from your authenticator app.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          secret,
          code: verifyCode.trim(),
          backupCodes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      setStep('backup');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, isBackup = false) => {
    navigator.clipboard.writeText(text);
    if (isBackup) {
      setCopiedBackup(true);
      setTimeout(() => setCopiedBackup(false), 2000);
    } else {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  const downloadBackupCodes = () => {
    const content = `DualScribe - Two-Factor Authentication Backup Codes\nGenerated: ${new Date().toLocaleString()}\n\nKeep these recovery codes in a safe place. Each code can be used once to access your account if you lose your phone:\n\n${backupCodes.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dualscribe-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

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

        {step === 'loading' && (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="animate-spin text-neutral-900" size={36} />
            <p className="text-sm font-medium text-neutral-600">Generating secure two-factor credentials...</p>
          </div>
        )}

        {step === 'setup' && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shrink-0">
                <Shield size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-neutral-900">Set Up Two-Factor Authentication</h3>
                <p className="text-xs text-neutral-500">Protect your DualScribe account with an extra layer of security.</p>
              </div>
            </div>

            {error && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-600 text-xs font-medium">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200/70 space-y-4">
              <p className="text-xs font-semibold text-neutral-700">
                1. Scan the QR code with Google Authenticator, Microsoft Authenticator, Apple Passwords, or 1Password:
              </p>

              {qrCodeDataUrl && (
                <div className="flex justify-center bg-white p-3 rounded-xl border border-neutral-200 w-fit mx-auto shadow-sm">
                  <img src={qrCodeDataUrl} alt="2FA QR Code" className="w-44 h-44" />
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-xs text-neutral-500">Can't scan the QR code? Copy the manual setup key:</p>
                <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-neutral-200">
                  <code className="text-xs font-mono text-neutral-800 tracking-wider flex-1 truncate select-all font-bold">
                    {secret}
                  </code>
                  <button
                    onClick={() => copyToClipboard(secret)}
                    className="px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg flex items-center gap-1 shrink-0 border border-neutral-200 transition-colors"
                  >
                    {copiedSecret ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    {copiedSecret ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-neutral-700">
                2. Enter the 6-digit code shown in your authenticator app to verify:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="flex-1 px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl font-mono text-center text-lg tracking-widest font-bold focus:ring-2 focus:ring-neutral-900 focus:bg-white outline-none transition-all"
                />
                <button
                  onClick={handleVerifyAndEnable}
                  disabled={isSubmitting || verifyCode.length < 6}
                  className="px-6 py-3 bg-neutral-900 text-white rounded-xl font-semibold text-sm hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shrink-0"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Verify & Activate
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'backup' && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <Check size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-neutral-900">2FA Enabled Successfully!</h3>
                <p className="text-xs text-neutral-500">Save your emergency backup recovery codes below.</p>
              </div>
            </div>

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <KeyRound size={14} /> Important: Save Emergency Recovery Codes
              </p>
              <p className="text-xs text-amber-800 leading-relaxed">
                If you lose access to your authenticator app or phone, you can use one of these one-time codes to sign in.
              </p>
            </div>

            <div className="bg-neutral-900 text-neutral-100 p-4 rounded-2xl font-mono text-sm grid grid-cols-2 gap-2 text-center border border-neutral-800">
              {backupCodes.map((code, idx) => (
                <div key={idx} className="bg-neutral-800/70 py-1.5 px-3 rounded-lg select-all text-xs font-bold tracking-wider text-emerald-400">
                  {code}
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                onClick={() => copyToClipboard(backupCodes.join('\n'), true)}
                className="flex-1 py-2.5 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors border border-neutral-200"
              >
                {copiedBackup ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                {copiedBackup ? 'Codes Copied' : 'Copy All Codes'}
              </button>

              <button
                onClick={downloadBackupCodes}
                className="flex-1 py-2.5 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors border border-neutral-200"
              >
                <Download size={14} />
                Download Codes (.txt)
              </button>
            </div>

            <button
              onClick={() => {
                onSuccess();
                onClose();
              }}
              className="w-full py-3 bg-neutral-900 hover:bg-neutral-800 text-white font-semibold text-sm rounded-xl transition-colors"
            >
              Done & Finish Setup
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};
