import React, { useState } from 'react';
import { User, Key, Shield, ShieldCheck, ShieldAlert, Check, ExternalLink, Loader2, AlertCircle, Trash2, Lock } from 'lucide-react';
import { UserData } from '../types';
import { ApiKeyModal } from './ApiKeyModal';
import { MfaModal } from './MfaModal';

interface SettingsViewProps {
  user: UserData;
  onUserUpdate: (updated: Partial<UserData>) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ user, onUserUpdate }) => {
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);

  // Disable MFA state
  const [isDisablingMfa, setIsDisablingMfa] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Change password state
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePassword) {
      setDisableError('Please enter your account password to disable 2FA.');
      return;
    }

    setDisableLoading(true);
    setDisableError(null);
    try {
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          password: disablePassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disable MFA.');

      onUserUpdate({ mfaEnabled: false });
      setIsDisablingMfa(false);
      setDisablePassword('');
    } catch (err: any) {
      setDisableError(err.message);
    } finally {
      setDisableLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long.');
      return;
    }

    setPasswordLoading(true);
    setPasswordError(null);
    setPasswordSuccess(null);

    try {
      const res = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password.');

      setPasswordSuccess('Password changed successfully.');
      setNewPassword('');
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Account & Security Settings</h2>
        <p className="text-xs text-neutral-500 mt-1">
          Manage your Gemini API keys, multi-factor authentication, and account details.
        </p>
      </div>

      {/* 1. BYOK GEMINI API KEY SECTION */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 shadow-xs border border-neutral-200/80 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shrink-0">
              <Key size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-900">Google Gemini API Key</h3>
              <p className="text-xs text-neutral-500">Bring Your Own Key (BYOK) for LLM transcription</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user.hasApiKey ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Active Key Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                API Key Required
              </span>
            )}
          </div>
        </div>

        <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200/70 text-xs text-neutral-600 leading-relaxed space-y-2">
          <p>
            DualScribe runs exclusively on your personal Google Gemini API key. Calls are proxied securely through the server without exposing secrets to the browser or incurring developer markups.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-bold text-neutral-900 hover:underline"
            >
              <span>Get your free key from Google AI Studio</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
          <div>
            <p className="text-xs font-semibold text-neutral-700">Configured Key:</p>
            <p className="text-xs font-mono text-neutral-500 mt-0.5">
              {user.maskedApiKey || (user.hasApiKey ? '••••••••••••••••' : 'No API key configured')}
            </p>
          </div>

          <button
            onClick={() => setIsApiKeyModalOpen(true)}
            className="px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-xs"
          >
            {user.hasApiKey ? 'Change / Manage Key' : 'Connect Gemini API Key'}
          </button>
        </div>
      </section>

      {/* 2. MULTI-FACTOR AUTHENTICATION (MFA) SECTION */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 shadow-xs border border-neutral-200/80 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shrink-0">
              <Shield size={22} />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-900">Multi-Factor Authentication (2FA)</h3>
              <p className="text-xs text-neutral-500">Require an authenticator code when signing in</p>
            </div>
          </div>

          <div>
            {user.mfaEnabled ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold">
                <ShieldCheck size={14} className="text-emerald-600" />
                2FA Enabled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-full text-xs font-semibold">
                <ShieldAlert size={14} className="text-neutral-400" />
                2FA Disabled
              </span>
            )}
          </div>
        </div>

        <div className="p-4 bg-neutral-50 rounded-2xl border border-neutral-200/70 text-xs text-neutral-600 leading-relaxed">
          {user.mfaEnabled ? (
            <p>
              Two-Factor Authentication is active on your account. When you log in, you will be prompted for a 6-digit TOTP code generated by Google Authenticator, Microsoft Authenticator, Apple Passwords, or 1Password.
            </p>
          ) : (
            <p>
              Two-Factor Authentication adds an extra layer of defense by preventing unauthorized sign-ins even if someone learns your password.
            </p>
          )}
        </div>

        {!user.mfaEnabled ? (
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setIsMfaModalOpen(true)}
              className="px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-xs flex items-center gap-1.5"
            >
              <ShieldCheck size={15} />
              <span>Enable Two-Factor Authentication</span>
            </button>
          </div>
        ) : !isDisablingMfa ? (
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setIsDisablingMfa(true)}
              className="px-4 py-2 bg-neutral-100 text-red-600 hover:bg-red-50 border border-neutral-200 hover:border-red-200 rounded-xl text-xs font-semibold transition-colors"
            >
              Disable Two-Factor Authentication
            </button>
          </div>
        ) : (
          <form onSubmit={handleDisableMfa} className="p-4 bg-red-50/70 border border-red-200 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-red-900">Confirm Disabling 2FA</p>
              <button
                type="button"
                onClick={() => {
                  setIsDisablingMfa(false);
                  setDisableError(null);
                  setDisablePassword('');
                }}
                className="text-xs text-neutral-500 hover:text-neutral-900"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-red-700">Enter your account password to confirm removal of two-factor protection:</p>

            {disableError && (
              <div className="text-xs text-red-600 font-medium">{disableError}</div>
            )}

            <div className="flex gap-2">
              <input
                type="password"
                required
                placeholder="Account password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className="flex-1 px-3 py-2 bg-white border border-red-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="submit"
                disabled={disableLoading || !disablePassword}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {disableLoading && <Loader2 size={13} className="animate-spin" />}
                Confirm Disable
              </button>
            </div>
          </form>
        )}
      </section>

      {/* 3. PROFILE & PASSWORD UPDATE */}
      <section className="bg-white rounded-3xl p-6 sm:p-8 shadow-xs border border-neutral-200/80 space-y-6">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shrink-0">
            <User size={22} />
          </div>
          <div>
            <h3 className="text-base font-bold text-neutral-900">Account Profile</h3>
            <p className="text-xs text-neutral-500">Your registered email and credentials</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/70">
            <span className="text-neutral-400 font-medium block">Email Address</span>
            <span className="font-semibold text-neutral-800 text-sm mt-0.5 block">{user.email}</span>
          </div>

          <div className="p-3.5 bg-neutral-50 rounded-xl border border-neutral-200/70">
            <span className="text-neutral-400 font-medium block">Account ID</span>
            <span className="font-semibold text-neutral-800 text-sm mt-0.5 block">#{user.id}</span>
          </div>
        </div>

        <form onSubmit={handleChangePassword} className="space-y-3 pt-2">
          <p className="text-xs font-bold text-neutral-800">Change Account Password</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              placeholder="New password (min. 6 characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="flex-1 px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-neutral-900 focus:bg-white"
            />
            <button
              type="submit"
              disabled={passwordLoading || newPassword.length < 6}
              className="px-5 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
            >
              {passwordLoading && <Loader2 size={13} className="animate-spin" />}
              Update Password
            </button>
          </div>
          {passwordSuccess && (
            <p className="text-xs text-emerald-600 font-medium">{passwordSuccess}</p>
          )}
          {passwordError && (
            <p className="text-xs text-red-600 font-medium">{passwordError}</p>
          )}
        </form>
      </section>

      {/* Modals */}
      <ApiKeyModal
        userId={user.id}
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        currentMaskedKey={user.maskedApiKey}
        onSuccess={(maskedKey) => {
          onUserUpdate({
            hasApiKey: !!maskedKey,
            maskedApiKey: maskedKey,
          });
        }}
      />

      <MfaModal
        userId={user.id}
        isOpen={isMfaModalOpen}
        onClose={() => setIsMfaModalOpen(false)}
        onSuccess={() => {
          onUserUpdate({ mfaEnabled: true });
        }}
      />
    </div>
  );
};
