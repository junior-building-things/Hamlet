'use client';
import { useEffect, useState } from 'react';
import { Feature, Priority } from '@/lib/types';
import { X, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';

interface Props {
  mode: 'add' | 'edit';
  feature?: Feature;
  onSave: (feature: Feature) => void;
  onClose: () => void;
  onNodeCompleted?: (featureId: string) => void;
}

// ─── Static option lists ──────────────────────────────────────────────────────

const PRIORITIES = [
  { id: '0', label: 'P0' as Priority },
  { id: '1', label: 'P1' as Priority },
  { id: '2', label: 'P2' as Priority },
  { id: '3', label: 'P3' as Priority },
];

const QUARTERLY_CYCLES = [
  { id: '15axr3g7g', label: '2026-Q1' },
  { id: '5350il55y', label: '2026-Q2' },
  { id: '3y4d9_0oy', label: '2026-Q3' },
];

const BUSINESS_LINES = [
  { id: 'y7mcg3xr1',  label: 'Core experience' },
  { id: '_hdtkvolb',  label: 'Business and Creator Messaging' },
  { id: '2hj6rn3ao',  label: 'Social Messaging' },
  { id: 'g3zl853ku',  label: 'DM Infra' },
  { id: 'ugt0a2p06',  label: 'DM Standalone App' },
];

const SOCIAL_COMPONENTS = [
  { id: 'mz8vxxems',           label: 'Sticker & Typing Rec' },
  { id: 'lpdmxqui2',           label: 'AI in DM' },
  { id: 'xory3g7r6',           label: 'Chat experience' },
  { id: 'vpw0ytamc',           label: 'Group chat' },
  { id: 'uyk6ev819',           label: 'Avatar' },
  { id: 'elnrsmb1h',           label: 'DM Camera' },
  { id: 'hzxm3i0l3',           label: 'DM Growth' },
  { id: 'vg3bccd0p',           label: 'Rich Message (sticker & camera)' },
  { id: 'Advanced message types', label: 'Advanced message types' },
  { id: 'DM tech Horizontal',  label: 'Tech Horizontal' },
  { id: 'ea3daoeps',           label: 'Streak' },
  { id: 'cldbdsu8k',           label: 'B2C (Business Messaging)' },
  { id: 'n9owpaqxm',           label: 'Inbox & Notice' },
  { id: 'f5hto66ka',           label: 'Relation' },
  { id: 'hyojgtl64',           label: 'Internal Share' },
  { id: '4gvqfvw9l',           label: 'DM Push' },
  { id: '4u0yg974v',           label: 'IMSDK' },
  { id: 'g16xgcqb3',           label: 'Messaging Safety & Permission' },
  { id: 'dya1s1cea',           label: 'Platforms (Msg Management+SCP)' },
  { id: 'IMCloud',             label: 'IMCloud' },
];

const TECH_OWNERS = [
  { key: '7210676945535778820', label: 'Austin Lee' },
  { key: '7291604705006895105', label: 'Kyle Chan' },
  { key: '6990536503940218908', label: 'Xuan Sheng' },
  { key: '7405623196516450307', label: 'Tianyang Ni' },
];

const ANDROID_OWNERS = [
  { key: '7210676945535778820', label: 'Austin Lee' },
  { key: '6990536503940218908', label: 'Xuan Sheng' },
];

const IOS_OWNERS = [
  { key: 'baorishouaries',     label: 'Rishou Bao' },
  { key: '7226934680916967426', label: 'Kim Li' },
];

const UIUX_OWNERS = [
  { key: '7205032929586593796', label: 'Tao Zhu' },
  { key: '7493184335885942785', label: 'Hazel Li' },
];

// Pre-selected members
const PRESET = {
  da:              { key: '7107489609088647170', name: 'Lionel Lew' },
  contentDesigner: { key: '7005856195756032028', name: 'Edward Lin' },
  qa:              { key: '7242202760668643331', name: 'Xiaobo Tian' },
};

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-bold tracking-wide text-gray-400">{title}</h3>
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

// ─── Create-form sub-components ───────────────────────────────────────────────

function FormLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="text-[11px] text-gray-500 font-medium">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </span>
  );
}

const inputCls  = 'w-full bg-[#13162a] border border-[#2e3460] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500 placeholder-gray-600';
const selectCls = 'w-full bg-[#13162a] border border-[#2e3460] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500';

// ─── Main component ───────────────────────────────────────────────────────────

export function FeatureModal({ mode, feature, onSave, onClose, onNodeCompleted }: Props) {

  // ── Edit-mode state ──
  const [completing, setCompleting]       = useState(false);
  const [completed, setCompleted]         = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // ── Add-mode state ──
  const [form, setForm] = useState({
    name:            '',
    priority:        '1',          // P1 default
    quarterlyCycle:  '5350il55y',  // 2026-Q2 default
    businessLine:    '2hj6rn3ao',  // Social Messaging default
    socialComponent: 'mz8vxxems', // Sticker & Typing Rec default
    techOwner:       '',
    android:         '',
    ios:             '',
    uiux:            '',
  });
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isMeego     = !!(feature?.meegoUrl);
  const canComplete = feature?.canCompleteNode === true;
  const nodeName    = feature?.status ?? '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setSubmitError(null);

    const roles: Array<{ role: string; owners: string[] }> = [
      { role: 'DA',       owners: [PRESET.da.key] },
      { role: 'UX_Writer',owners: [PRESET.contentDesigner.key] },
      { role: 'QA',       owners: [PRESET.qa.key] },
    ];
    if (form.techOwner) roles.push({ role: 'Tech_Owner', owners: [form.techOwner] });
    if (form.android)   roles.push({ role: 'Android',    owners: [form.android] });
    if (form.ios)       roles.push({ role: 'iOS',        owners: [form.ios] });
    if (form.uiux)      roles.push({ role: 'UI',         owners: [form.uiux] });

    const priority = (PRIORITIES.find(p => p.id === form.priority)?.label ?? 'P2') as Priority;

    try {
      const res = await fetch('/api/meego/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                    form.name.trim(),
          priority,
          quarterlyCycleOptionId:  form.quarterlyCycle  || undefined,
          businessLineOptionId:    form.businessLine    || undefined,
          socialComponentOptionId: form.socialComponent || undefined,
          roles,
        }),
      });
      const data = await res.json() as { id?: string; meegoUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Create failed');

      onSave({
        id:              data.id ?? String(Date.now()),
        name:            form.name.trim(),
        description:     '',
        status:          'Requirements Prep',
        priority,
        owner:           'Thomas',
        tasks:           [],
        lastUpdated:     new Date().toISOString().split('T')[0],
        meegoUrl:        data.meegoUrl,
        meegoIssueId:    data.id,
        meegoProjectKey: TIKTOK_PROJECT_KEY,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create feature');
      setSubmitting(false);
    }
  }

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

  // ── Add mode ──────────────────────────────────────────────────────────────

  if (mode === 'add') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-[#0e1120] border border-[#1e2240] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="px-6 py-4 border-b border-[#1e2240] shrink-0 flex items-center justify-between">
            <h2 className="text-white font-semibold text-lg">New Feature</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable form + footer in one <form> */}
          <form onSubmit={handleCreate} className="flex flex-col min-h-0 flex-1">
            <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto flex-1">

              {/* Feature name */}
              <div className="flex flex-col gap-1.5">
                <FormLabel required>Feature name</FormLabel>
                <input
                  autoFocus
                  type="text"
                  className={inputCls}
                  placeholder="Enter feature name…"
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                />
              </div>

              {/* Priority + Quarterly Cycle */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <FormLabel required>Priority</FormLabel>
                  <select className={selectCls} value={form.priority} onChange={e => setField('priority', e.target.value)}>
                    {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FormLabel>Quarterly Cycle</FormLabel>
                  <select className={selectCls} value={form.quarterlyCycle} onChange={e => setField('quarterlyCycle', e.target.value)}>
                    <option value="">—</option>
                    {QUARTERLY_CYCLES.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Business Line */}
              <div className="flex flex-col gap-1.5">
                <FormLabel>Business Line</FormLabel>
                <select className={selectCls} value={form.businessLine} onChange={e => setField('businessLine', e.target.value)}>
                  <option value="">—</option>
                  {BUSINESS_LINES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>

              {/* Social Component */}
              <div className="flex flex-col gap-1.5">
                <FormLabel>Social Component</FormLabel>
                <select className={selectCls} value={form.socialComponent} onChange={e => setField('socialComponent', e.target.value)}>
                  <option value="">—</option>
                  {SOCIAL_COMPONENTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              {/* Optional roles */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <FormLabel>Tech Owner</FormLabel>
                  <select className={selectCls} value={form.techOwner} onChange={e => setField('techOwner', e.target.value)}>
                    <option value="">—</option>
                    {TECH_OWNERS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FormLabel>Android</FormLabel>
                  <select className={selectCls} value={form.android} onChange={e => setField('android', e.target.value)}>
                    <option value="">—</option>
                    {ANDROID_OWNERS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FormLabel>iOS</FormLabel>
                  <select className={selectCls} value={form.ios} onChange={e => setField('ios', e.target.value)}>
                    <option value="">—</option>
                    {IOS_OWNERS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FormLabel>UI&UX</FormLabel>
                  <select className={selectCls} value={form.uiux} onChange={e => setField('uiux', e.target.value)}>
                    <option value="">—</option>
                    {UIUX_OWNERS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Pre-selected roles */}
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <FormLabel>DA</FormLabel>
                  <select className={selectCls} defaultValue={PRESET.da.key}>
                    <option value={PRESET.da.key}>{PRESET.da.name}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FormLabel>Content Designer</FormLabel>
                  <select className={selectCls} defaultValue={PRESET.contentDesigner.key}>
                    <option value={PRESET.contentDesigner.key}>{PRESET.contentDesigner.name}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <FormLabel>QA</FormLabel>
                  <select className={selectCls} defaultValue={PRESET.qa.key}>
                    <option value={PRESET.qa.key}>{PRESET.qa.name}</option>
                  </select>
                </div>
              </div>

              {submitError && <p className="text-xs text-red-400">{submitError}</p>}

            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#1e2240] shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-[#1e2240] text-gray-300 hover:text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.name.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                  : 'Create in Meego'}
              </button>
            </div>
          </form>

        </div>
      </div>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────

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
