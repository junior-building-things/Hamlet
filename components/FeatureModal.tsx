'use client';
import { useEffect } from 'react';
import { Feature } from '@/lib/types';
import { X, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

interface Props {
  mode: 'add' | 'edit';
  feature?: Feature;
  onSave: (feature: Feature) => void;
  onClose: () => void;
  onNodeCompleted?: (featureId: string) => void;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h3 className="text-xs font-bold tracking-wide text-gray-400 whitespace-nowrap">{title}</h3>
      <div className="flex-1 h-px bg-[#1e2240]" />
    </div>
  );
}

function InfoField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      <span className="text-sm text-gray-200">{value || '—'}</span>
    </div>
  );
}

export function FeatureModal({ mode, feature, onClose, onNodeCompleted }: Props) {
  const [completing, setCompleting]       = useState(false);
  const [completed, setCompleted]         = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const isMeego     = !!(feature?.meegoUrl);
  const canComplete = feature?.canCompleteNode === true;
  const nodeName    = feature?.status ?? '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleCompleteNode() {
    if (!feature?.meegoProjectKey || !feature?.meegoIssueId || !feature?.meegoNodeKey) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const res = await fetch('/api/meego/complete-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey: feature.meegoProjectKey,
          workItemId: feature.meegoIssueId,
          nodeKey:    feature.meegoNodeKey,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed to complete node');
      }
      setCompleted(true);
      onNodeCompleted?.(feature.id);
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCompleting(false);
    }
  }

  if (mode === 'add') {
    // Keep a minimal add form (not part of this redesign)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-[#0e1120] border border-[#1e2240] rounded-2xl w-full max-w-lg shadow-2xl p-6">
          <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
          <p className="text-gray-400 text-sm">New features are created in Meego.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0e1120] border border-[#1e2240] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1e2240] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-white font-semibold text-lg leading-snug pr-2">
              {feature?.name ?? 'Feature'}
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors shrink-0 mt-0.5">
              <X className="w-5 h-5" />
            </button>
          </div>
          {isMeego && (
            <div className="flex items-center gap-4 mt-1.5">
              <a href={feature?.meegoUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                Meego <ExternalLink className="w-3 h-3" />
              </a>
              {feature?.prd && (
                <a href={feature.prd} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  PRD <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {feature?.complianceUrl && (
                <a href={feature.complianceUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                  Compliance <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="px-6 py-5 flex flex-col gap-0 overflow-y-auto divide-y divide-[#1e2240]">

          {/* Current Status */}
          <div className="pb-5">
            <SectionHeader title="Current Status" />
            <InfoField label="Node" value={nodeName} />
            {isMeego && canComplete && (
              <div className="mt-3">
                {completed ? (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" /> Node completed!
                  </div>
                ) : (
                  <button
                    onClick={handleCompleteNode}
                    disabled={completing}
                    className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                  >
                    {completing
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Completing…</>
                      : <>Complete: {nodeName} →</>}
                  </button>
                )}
                {completeError && <p className="text-xs text-red-400 mt-1">{completeError}</p>}
              </div>
            )}
            {isMeego && feature?.canCompleteNode === false && (
              <p className="text-xs text-gray-600 mt-1">Not assigned to you</p>
            )}
          </div>

          {/* Feature Details */}
          <div className="py-5">
            <SectionHeader title="Feature Details" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <InfoField label="Priority"        value={feature?.priority} />
              <InfoField label="Quarterly Cycle" value={feature?.quarterlyCycle} />
              <InfoField label="Business Line"   value={feature?.businessLine} />
              <InfoField label="Social Component" value={feature?.socialComponent} />
            </div>
          </div>

          {/* POC Details */}
          <div className="pt-5">
            <SectionHeader title="POC Details" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <InfoField label="Tech Owner"       value={feature?.techOwner} />
              <InfoField label="iOS"              value={feature?.iosOwner} />
              <InfoField label="Android"          value={feature?.androidOwner} />
              <InfoField label="Server"           value={feature?.serverOwner} />
              <InfoField label="QA"               value={feature?.qaOwner} />
              <InfoField label="DA"               value={feature?.daOwner} />
              <InfoField label="UI&UX"            value={feature?.uiuxOwner} />
              <InfoField label="Content Designer" value={feature?.contentDesigner} />
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-[#1e2240] shrink-0">
          <button onClick={onClose} className="px-5 py-2 bg-[#1e2240] text-gray-300 hover:text-white text-sm font-semibold rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
