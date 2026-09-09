import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  History, 
  Settings, 
  LogOut, 
  Key, 
  ShieldCheck, 
  FileText,
  User,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';

import { UserData, TranscriptionRecord, TranscriptionResult, AppTab } from './types';
import { Logo } from './components/Logo';
import { AuthView } from './components/AuthView';
import { TranscriptionView } from './components/TranscriptionView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { ApiKeyModal } from './components/ApiKeyModal';

export default function App() {
  const [user, setUser] = useState<UserData | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('transcribe');
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<{ filename: string; result: TranscriptionResult } | null>(null);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);

  // Restore user session
  useEffect(() => {
    const saved = localStorage.getItem('dualscribe_user');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setUser(parsed);
        refreshUserProfile(parsed.id);
        fetchHistory(parsed.id);
      } catch {
        localStorage.removeItem('dualscribe_user');
      }
    }
  }, []);

  const refreshUserProfile = async (userId: number) => {
    try {
      const res = await fetch(`/api/user/profile/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setUser((prev) => {
          const updated = {
            ...prev,
            ...data,
          };
          localStorage.setItem('dualscribe_user', JSON.stringify(updated));
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to sync profile', err);
    }
  };

  const fetchHistory = async (userId: number) => {
    try {
      const res = await fetch(`/api/transcriptions/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch history', err);
    }
  };

  const handleLoginSuccess = (userData: UserData) => {
    setUser(userData);
    localStorage.setItem('dualscribe_user', JSON.stringify(userData));
    setActiveTab('transcribe');
    refreshUserProfile(userData.id);
    fetchHistory(userData.id);
  };

  const handleLogout = () => {
    localStorage.removeItem('dualscribe_user');
    setUser(null);
    setHistory([]);
    setSelectedHistoryItem(null);
  };

  const handleTranscriptionSuccess = async (filename: string, result: TranscriptionResult) => {
    if (!user) return;
    try {
      await fetch('/api/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          filename,
          language: result.language,
          result,
        }),
      });
      fetchHistory(user.id);
    } catch (err) {
      console.error('Failed to persist history', err);
    }
  };

  const handleDeleteHistoryRecord = async (id: number) => {
    try {
      await fetch(`/api/transcriptions/record/${id}`, {
        method: 'DELETE',
      });
      setHistory((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Failed to delete history record', err);
    }
  };

  const getCleanFilename = (originalName: string, ext: string) => {
    const base = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
    return `${base}.${ext}`;
  };

  const exportToPDF = (res: TranscriptionResult, filename: string) => {
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text('DualScribe - Transcription Notes', 14, 20);
    doc.setFontSize(10);
    doc.text(`File: ${filename} | Detected Language: ${res.language || 'Egyptian Arabic / English'}`, 14, 28);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 34);

    doc.setDrawColor(200, 200, 200);
    doc.line(14, 38, 196, 38);

    let y = 48;
    if (res.segments && res.segments.length > 0) {
      res.segments.forEach((seg) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(`${seg.speaker}:`, 14, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const lines = doc.splitTextToSize(seg.text, 180);
        doc.text(lines, 14, y);
        y += lines.length * 6 + 6;
      });
    } else {
      const lines = doc.splitTextToSize(res.fullText || '', 180);
      doc.text(lines, 14, y);
    }

    doc.save(getCleanFilename(filename, 'pdf'));
  };

  const exportToDocx = async (res: TranscriptionResult, filename: string) => {
    const segmentsParagraphs = res.segments?.flatMap((seg) => [
      new Paragraph({
        children: [new TextRun({ text: `${seg.speaker}:`, bold: true, size: 22 })],
        spacing: { before: 200, after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: seg.text, size: 22 })],
        spacing: { after: 140 },
      }),
    ]) || [
      new Paragraph({
        children: [new TextRun({ text: res.fullText || '', size: 22 })],
      }),
    ];

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'DualScribe Transcription Notes', bold: true, size: 32 }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `File: ${filename}  •  Language: ${res.language || 'Egyptian Arabic / English'}`,
                  italics: true,
                  size: 20,
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 260 },
            }),
            ...segmentsParagraphs,
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, getCleanFilename(filename, 'docx'));
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-neutral-900 font-sans antialiased flex flex-col selection:bg-neutral-900 selection:text-white">
      {/* Top Navbar */}
      <header className="bg-white border-b border-neutral-200/80 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div
            onClick={() => user && setActiveTab('transcribe')}
            className="cursor-pointer"
          >
            <Logo variant="compact" />
          </div>

          {user && (
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Navigation Tabs */}
              <nav className="hidden md:flex items-center rounded-xl bg-neutral-100 p-1 border border-neutral-200/60">
                <button
                  onClick={() => {
                    setSelectedHistoryItem(null);
                    setActiveTab('transcribe');
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    activeTab === 'transcribe'
                      ? 'bg-white text-neutral-900 shadow-xs'
                      : 'text-neutral-500 hover:text-neutral-900'
                  }`}
                >
                  <Sparkles size={14} />
                  <span>Transcribe</span>
                </button>

                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    activeTab === 'history'
                      ? 'bg-white text-neutral-900 shadow-xs'
                      : 'text-neutral-500 hover:text-neutral-900'
                  }`}
                >
                  <History size={14} />
                  <span>History</span>
                  {history.length > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.2 bg-neutral-200 text-neutral-800 rounded-full text-[10px]">
                      {history.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('settings')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    activeTab === 'settings'
                      ? 'bg-white text-neutral-900 shadow-xs'
                      : 'text-neutral-500 hover:text-neutral-900'
                  }`}
                >
                  <Settings size={14} />
                  <span>Settings</span>
                </button>
              </nav>

              {/* BYOK Gemini API Key Status Badge */}
              <button
                onClick={() => setIsApiKeyModalOpen(true)}
                className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  user.hasApiKey
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80 hover:bg-emerald-100/60'
                    : 'bg-amber-50 text-amber-800 border-amber-200/80 hover:bg-amber-100/60 animate-pulse'
                }`}
                title="Manage personal Google Gemini API Key"
              >
                <Key size={13} />
                <span>{user.hasApiKey ? 'Gemini Key: Connected' : 'Gemini Key Required'}</span>
              </button>

              {/* Mobile Tab Icons */}
              <div className="flex md:hidden items-center gap-1">
                <button
                  onClick={() => {
                    setSelectedHistoryItem(null);
                    setActiveTab('transcribe');
                  }}
                  className={`p-2 rounded-xl transition-colors ${
                    activeTab === 'transcribe' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Transcribe"
                >
                  <Sparkles size={18} />
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  className={`p-2 rounded-xl transition-colors ${
                    activeTab === 'history' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="History"
                >
                  <History size={18} />
                </button>
                <button
                  onClick={() => setActiveTab('settings')}
                  className={`p-2 rounded-xl transition-colors ${
                    activeTab === 'settings' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                  title="Settings"
                >
                  <Settings size={18} />
                </button>
              </div>

              {/* Logout Button */}
              <button
                onClick={handleLogout}
                className="p-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-xl transition-colors"
                title="Log Out"
              >
                <LogOut size={18} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 md:py-10">
        {!user ? (
          <AuthView onLoginSuccess={handleLoginSuccess} />
        ) : activeTab === 'settings' ? (
          <SettingsView
            user={user}
            onUserUpdate={(updated) => {
              setUser((prev: any) => {
                const merged = { ...prev, ...updated };
                localStorage.setItem('dualscribe_user', JSON.stringify(merged));
                return merged;
              });
            }}
          />
        ) : activeTab === 'history' ? (
          <HistoryView
            history={history}
            onSelectRecord={(rec) => {
              setSelectedHistoryItem({ filename: rec.filename, result: rec.result });
              setActiveTab('transcribe');
            }}
            onDeleteRecord={handleDeleteHistoryRecord}
            onExportPdf={exportToPDF}
            onExportDocx={exportToDocx}
            onBackToTranscribe={() => {
              setSelectedHistoryItem(null);
              setActiveTab('transcribe');
            }}
          />
        ) : (
          <TranscriptionView
            user={user}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            onTranscriptionSuccess={handleTranscriptionSuccess}
            onExportPdf={exportToPDF}
            onExportDocx={exportToDocx}
            initialResult={selectedHistoryItem}
          />
        )}
      </main>

      {/* Persistent Footer */}
      <footer className="mt-auto border-t border-neutral-200/80 bg-white py-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-400">
          <p>© 2026 DualScribe. Instant, accurate bi-lingual notes.</p>
          <div className="flex items-center gap-4">
            <span>Egyptian Arabic & English Diarization</span>
            <span>•</span>
            <span>Zero Markup BYOK</span>
          </div>
        </div>
      </footer>

      {/* Global API Key Modal */}
      {user && (
        <ApiKeyModal
          userId={user.id}
          isOpen={isApiKeyModalOpen}
          onClose={() => setIsApiKeyModalOpen(false)}
          currentMaskedKey={user.maskedApiKey}
          onSuccess={(newMaskedKey) => {
            setUser((prev: any) => {
              const updated = {
                ...prev,
                hasApiKey: !!newMaskedKey,
                maskedApiKey: newMaskedKey,
              };
              localStorage.setItem('dualscribe_user', JSON.stringify(updated));
              return updated;
            });
          }}
        />
      )}
    </div>
  );
}
