'use client';
import { useState } from 'react';
import { X, ExternalLink } from 'lucide-react';

interface Props {
  androidQrUrl?: string;
  androidDownloadUrl?: string;
  iosQrUrl?: string;
  iosDownloadUrl?: string;
  featureName: string;
  defaultTab?: 'android' | 'ios';
  onClose: () => void;
}

export function PackageModal({ androidQrUrl, androidDownloadUrl, iosQrUrl, iosDownloadUrl, featureName, defaultTab, onClose }: Props) {
  const tabs = [
    ...(androidQrUrl ? [{ key: 'android' as const, label: 'Android' }] : []),
    ...(iosQrUrl ? [{ key: 'ios' as const, label: 'iOS' }] : []),
  ];

  const initialTab = defaultTab && tabs.some(t => t.key === defaultTab) ? defaultTab : tabs[0]?.key ?? 'android';
  const [activeTab, setActiveTab] = useState<'android' | 'ios'>(initialTab);

  const qrUrl = activeTab === 'ios' ? iosQrUrl : androidQrUrl;
  const downloadUrl = activeTab === 'ios' ? iosDownloadUrl : androidDownloadUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-[var(--background)] border border-[var(--border)] rounded-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-[var(--foreground)] text-base font-semibold truncate pr-4">Package</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-[var(--foreground)] transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Platform tabs */}
        {tabs.length > 1 && (
          <div className="flex border-b border-[var(--border)]">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'text-[var(--foreground)] border-b-2 border-blue-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex flex-col items-center gap-4 px-5 py-6">
          <p className="text-sm text-gray-400 text-center">{featureName}</p>

          {/* QR Code */}
          {qrUrl && (
            <div className="bg-white p-3 rounded-xl">
              <img src={qrUrl} alt="Package QR Code" className="w-48 h-48" />
            </div>
          )}

          <p className="text-xs text-gray-500">
            Scan to install {tabs.length > 1 ? (activeTab === 'ios' ? 'iOS' : 'Android') : tabs[0]?.label ?? ''} package
          </p>

          {/* Download link */}
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
              <span className="truncate max-w-[280px]">Download link</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
