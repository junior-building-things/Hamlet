'use client';
import { X, ExternalLink } from 'lucide-react';

interface Props {
  qrUrl: string;
  downloadUrl: string;
  featureName: string;
  onClose: () => void;
}

export function PackageModal({ qrUrl, downloadUrl, featureName, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-[#0e1120] border border-[#1e2240] rounded-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2240]">
          <h2 className="text-white text-base font-semibold truncate pr-4">Package</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col items-center gap-4 px-5 py-6">
          <p className="text-sm text-gray-400 text-center">{featureName}</p>

          {/* QR Code */}
          <div className="bg-white p-3 rounded-xl">
            <img src={qrUrl} alt="Package QR Code" className="w-48 h-48" />
          </div>

          <p className="text-xs text-gray-500">Scan to install</p>

          {/* Download link */}
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            <ExternalLink className="w-4 h-4 shrink-0" />
            <span className="truncate max-w-[280px]">Download link</span>
          </a>
        </div>
      </div>
    </div>
  );
}
