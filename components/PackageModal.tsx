'use client';
import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { X, ExternalLink } from 'lucide-react';

interface Props {
  androidQrUrl?: string;
  androidDownloadUrl?: string;
  androidPackageName?: string;
  androidBuildTime?: string;
  iosQrUrl?: string;
  iosDownloadUrl?: string;
  iosPackageName?: string;
  iosBuildTime?: string;
  featureName: string;
  defaultTab?: 'android' | 'ios';
  onClose: () => void;
}

export function PackageModal({
  androidQrUrl, androidDownloadUrl, androidPackageName, androidBuildTime,
  iosQrUrl, iosDownloadUrl, iosPackageName, iosBuildTime,
  featureName, defaultTab, onClose,
}: Props) {
  const tabs = [
    ...(androidQrUrl ? [{ key: 'android' as const, label: 'Android' }] : []),
    ...(iosQrUrl ? [{ key: 'ios' as const, label: 'iOS' }] : []),
  ];

  const initialTab = defaultTab && tabs.some(t => t.key === defaultTab) ? defaultTab : tabs[0]?.key ?? 'android';
  const [activeTab, setActiveTab] = useState<'android' | 'ios'>(initialTab);

  const qrUrl = activeTab === 'ios' ? iosQrUrl : androidQrUrl;
  const downloadUrl = activeTab === 'ios' ? iosDownloadUrl : androidDownloadUrl;
  const packageName = activeTab === 'ios' ? iosPackageName : androidPackageName;
  const buildTime = activeTab === 'ios' ? iosBuildTime : androidBuildTime;

  // Detect whether qrUrl is an image or a plain download URL. Bits returns the
  // APK URL in `qr_code_url`, so we render a QR from it client-side.
  // Legacy/Lark-chat data sometimes provides an actual image URL (ending in .png/.jpg).
  const isImageUrl = !!qrUrl && /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(qrUrl);
  const qrSource = qrUrl ?? downloadUrl ?? '';
  const [generatedQr, setGeneratedQr] = useState<string>('');

  useEffect(() => {
    if (!qrSource || isImageUrl) { setGeneratedQr(''); return; }
    QRCode.toDataURL(qrSource, { width: 256, margin: 1 })
      .then(setGeneratedQr)
      .catch(() => setGeneratedQr(''));
  }, [qrSource, isImageUrl]);

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
          {/* Title above the QR — use the build name (falls back to the feature name). */}
          <p className="text-sm font-medium text-[var(--foreground)] text-center break-all max-w-[300px]">
            {packageName || featureName}
          </p>

          {/* QR Code */}
          {(isImageUrl ? qrUrl : generatedQr) && (
            <div className="bg-white p-3 rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={isImageUrl ? qrUrl : generatedQr}
                alt="Package QR Code"
                className="w-48 h-48"
              />
            </div>
          )}

          {/* Caption under the QR — build time (SGT) when available, else install hint. */}
          <p className="text-xs text-gray-500 text-center">
            {buildTime || `Scan to install ${tabs.length > 1 ? (activeTab === 'ios' ? 'iOS' : 'Android') : tabs[0]?.label ?? ''} package`}
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
              <span className="truncate max-w-[280px]">Open Bits</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
