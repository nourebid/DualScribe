import React, { useState } from 'react';
import { History, FileText, FileDown, Download, Trash2, Search, Calendar, ChevronRight, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { TranscriptionRecord, TranscriptionResult } from '../types';

interface HistoryViewProps {
  history: TranscriptionRecord[];
  onSelectRecord: (record: TranscriptionRecord) => void;
  onDeleteRecord: (id: number) => void;
  onExportPdf: (res: TranscriptionResult, filename: string) => void;
  onExportDocx: (res: TranscriptionResult, filename: string) => void;
  onBackToTranscribe: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onSelectRecord,
  onDeleteRecord,
  onExportPdf,
  onExportDocx,
  onBackToTranscribe,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredHistory = history.filter((item) => {
    const term = searchTerm.toLowerCase();
    const filenameMatch = item.filename.toLowerCase().includes(term);
    const textMatch = item.result?.fullText?.toLowerCase().includes(term);
    const langMatch = item.language?.toLowerCase().includes(term);
    return filenameMatch || textMatch || langMatch;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Transcription History</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Access, view, and export all your past bilingual transcriptions.
          </p>
        </div>

        <button
          onClick={onBackToTranscribe}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors self-start sm:self-auto shadow-xs"
        >
          <ArrowLeft size={15} />
          <span>New Transcription</span>
        </button>
      </div>

      {history.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
          <input
            type="text"
            placeholder="Search transcripts by title, speaker notes, or content..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-neutral-200/80 rounded-2xl text-xs focus:ring-2 focus:ring-neutral-900 focus:border-transparent outline-none transition-all shadow-xs"
          />
        </div>
      )}

      {history.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl text-center border border-neutral-200/80 shadow-xs space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto">
            <History size={32} />
          </div>
          <div>
            <h3 className="text-base font-bold text-neutral-800">No Transcriptions Yet</h3>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
              Upload your first audio recording to generate instant bilingual notes with speaker diarization.
            </p>
          </div>
          <button
            onClick={onBackToTranscribe}
            className="px-5 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors inline-flex items-center gap-1.5 shadow-xs"
          >
            Start Transcribing
          </button>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="bg-white p-8 rounded-3xl text-center border border-neutral-200/80 shadow-xs">
          <p className="text-xs text-neutral-500">No transcripts match your search term "{searchTerm}".</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHistory.map((record) => (
            <motion.div
              key={record.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-5 rounded-2xl shadow-xs border border-neutral-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-neutral-300 transition-all group"
            >
              <div
                onClick={() => onSelectRecord(record)}
                className="flex items-start sm:items-center gap-3.5 cursor-pointer flex-1 min-w-0"
              >
                <div className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-800 flex items-center justify-center shrink-0 group-hover:bg-neutral-900 group-hover:text-white transition-colors">
                  <FileText size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-sm text-neutral-900 truncate group-hover:text-black">
                    {record.filename}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-neutral-400">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {new Date(record.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <span>•</span>
                    <span className="font-medium text-neutral-600 px-2 py-0.5 bg-neutral-100 rounded-md">
                      {record.language || 'Egyptian Arabic / English'}
                    </span>
                    <span>•</span>
                    <span>{record.result?.segments?.length || 1} segments</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                <button
                  onClick={() => onExportPdf(record.result, record.filename)}
                  className="p-2 hover:bg-neutral-100 rounded-lg text-neutral-600 hover:text-neutral-900 transition-colors border border-transparent hover:border-neutral-200"
                  title="Export PDF"
                >
                  <FileDown size={17} />
                </button>
                <button
                  onClick={() => onExportDocx(record.result, record.filename)}
                  className="p-2 hover:bg-neutral-100 rounded-lg text-neutral-600 hover:text-neutral-900 transition-colors border border-transparent hover:border-neutral-200"
                  title="Export DOCX"
                >
                  <Download size={17} />
                </button>
                <button
                  onClick={() => onDeleteRecord(record.id)}
                  className="p-2 hover:bg-red-50 rounded-lg text-neutral-400 hover:text-red-600 transition-colors"
                  title="Delete Record"
                >
                  <Trash2 size={17} />
                </button>
                <button
                  onClick={() => onSelectRecord(record)}
                  className="p-2 hover:bg-neutral-100 rounded-lg text-neutral-400 hover:text-neutral-900 transition-colors"
                  title="Open Transcript"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};
