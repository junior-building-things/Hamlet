'use client';
import { useState, useEffect } from 'react';
import { Feature, Priority } from '@/lib/types';
import { X, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';

const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];

interface NodeInfo {
  nodeKey: string;
  nodeName: string;
  canComplete: boolean;
  prd: string;
}

interface Props {
  mode: 'add' | 'edit';
  feature?: Feature;
  onSave: (feature: Feature) => void;
  onClose: () => void;
  onNodeCompleted?: (featureId: string) => void;
}

export function FeatureModal({ mode, feature, onSave, onClose, onNodeCompleted }: Props) {
  const [name, setName]         = useState(feature?.name ?? '');
  const [prd, setPrd]           = useState(feature?.prd ?? '');
  const [priority, setPriority] = useState<Priority>(feature?.priority ?? 'P2');

  const [nodeInfo, setNodeInfo]         = useState<NodeInfo | null>(null);
  const [loadingNode, setLoadingNode]   = useState(false);
  const [completing, setCompleting]     = useState(false);
  const [completed, setCompleted]       = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const isMeego = !!(feature?.meegoUrl);

  // Fetch node info when editing a Meego-linked feature
  useEffect(() => {
    if (mode !== 'edit' || !feature?.meegoUrl) return;
    setLoadingNode(true);
    fetch('/api/meego/node-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meegoUrl: feature.meegoUrl }),
    })
      .then(r => r.json())
      .then((data: NodeInfo) => {
        setNodeInfo(data);
        if (data.prd && !prd) setPrd(data.prd);
      })
      .catch(console.error)
      .finally(() => setLoadingNode(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      ...(feature ?? {
        id: `local-${Date.now()}`,
        description: '',
        status: '',
        owner: '',
        tasks: [],
        lastUpdated: new Date().toISOString().split('T')[0],
      }),
      name: name.trim(),
      prd: prd.trim() || undefined,
      priority,
      lastUpdated: new Date().toISOString().split('T')[0],
    } as Feature);
  }

  async function handleCompleteNode() {
    if (!feature?.meegoProjectKey || !feature?.meegoIssueId || !nodeInfo?.nodeKey) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const res = await fetch('/api/meego/complete-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectKey: feature.meegoProjectKey,
          workItemId: feature.meegoIssueId,
          nodeKey: nodeInfo.nodeKey,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0e1120] border border-[#1e2240] rounded-2xl w-full max-w-md shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2240]">
          <div>
            <h2 className="text-white font-semibold text-lg">
              {mode === 'add' ? 'New Feature' : 'Edit Feature'}
            </h2>
            {isMeego && (
              <a
                href={feature?.meegoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 mt-0.5"
              >
                Open in Meego <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">

          {/* Name */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1.5">Feature Name *</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter feature name"
              className="w-full bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-600 transition-colors"
            />
          </div>

          {/* PRD Link */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1.5">PRD Link</label>
            <input
              type="url"
              value={prd}
              onChange={e => setPrd(e.target.value)}
              placeholder="https://..."
              className="w-full bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-600 transition-colors"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-2">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors border ${
                    priority === p
                      ? p === 'P0' ? 'bg-red-900/50 border-red-700 text-red-300'
                      : p === 'P1' ? 'bg-orange-900/50 border-orange-700 text-orange-300'
                      : p === 'P2' ? 'bg-blue-900/50 border-blue-700 text-blue-300'
                      : 'bg-[#1e2240] border-[#2a3060] text-gray-300'
                      : 'bg-transparent border-[#1e2240] text-gray-500 hover:text-gray-300 hover:border-gray-600'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Complete Node — only for Meego features where user is assigned */}
          {mode === 'edit' && isMeego && (
            <div className="border-t border-[#1e2240] pt-4">
              {loadingNode ? (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking node…
                </div>
              ) : nodeInfo?.canComplete ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-gray-400">
                    Current node: <span className="text-white font-medium">{nodeInfo.nodeName}</span>
                  </p>
                  {completed ? (
                    <div className="flex items-center gap-2 text-emerald-400 text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      Node completed!
                    </div>
                  ) : (
                    <button
                      onClick={handleCompleteNode}
                      disabled={completing}
                      className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                    >
                      {completing
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Completing…</>
                        : <>Complete: {nodeInfo.nodeName} →</>
                      }
                    </button>
                  )}
                  {completeError && (
                    <p className="text-xs text-red-400">{completeError}</p>
                  )}
                </div>
              ) : nodeInfo && !nodeInfo.canComplete ? (
                <p className="text-xs text-gray-600">
                  Current node: <span className="text-gray-500">{nodeInfo.nodeName}</span>
                  {' '}— not assigned to you
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#1e2240]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-5 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mode === 'add' ? 'Add Feature' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
