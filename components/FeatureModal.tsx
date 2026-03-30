'use client';
import { useEffect, useState } from 'react';
import { Feature, Priority } from '@/lib/types';
import { X, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { AvatarSelect, CustomSelect, AvatarOption, UserAvatar } from './AvatarSelect';
import { AV } from '@/lib/avatars';

interface Props {
  mode: 'add' | 'edit';
  feature?: Feature;
  onSave: (feature: Feature) => void;
  onClose: () => void;
  onNodeCompleted?: (featureId: string) => void;
  /** Called after background creation completes. null = failed (temp entry should be removed). */
  onFeatureCreated?: (tempId: string, feature: Feature | null) => void;
}

function av(name: string): AvatarOption { return { value: name, label: name, avatarUrl: AV[name] }; }

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
  { id: 'mz8vxxems',              label: 'Sticker & Typing Rec' },
  { id: 'lpdmxqui2',              label: 'AI in DM' },
  { id: 'xory3g7r6',              label: 'Chat experience' },
  { id: 'vpw0ytamc',              label: 'Group chat' },
  { id: 'uyk6ev819',              label: 'Avatar' },
  { id: 'elnrsmb1h',              label: 'DM Camera' },
  { id: 'hzxm3i0l3',              label: 'DM Growth' },
  { id: 'vg3bccd0p',              label: 'Rich Message (sticker & camera)' },
  { id: 'Advanced message types', label: 'Advanced message types' },
  { id: 'DM tech Horizontal',     label: 'Tech Horizontal' },
  { id: 'ea3daoeps',              label: 'Streak' },
  { id: 'cldbdsu8k',              label: 'B2C (Business Messaging)' },
  { id: 'n9owpaqxm',              label: 'Inbox & Notice' },
  { id: 'f5hto66ka',              label: 'Relation' },
  { id: 'hyojgtl64',              label: 'Internal Share' },
  { id: '4gvqfvw9l',              label: 'DM Push' },
  { id: '4u0yg974v',              label: 'IMSDK' },
  { id: 'g16xgcqb3',              label: 'Messaging Safety & Permission' },
  { id: 'dya1s1cea',              label: 'Platforms (Msg Management+SCP)' },
  { id: 'IMCloud',                label: 'IMCloud' },
];

// Role members with keys + avatars
const TECH_OWNERS: AvatarOption[] = [
  { value: '7210676945535778820', label: 'Austin Lee',   avatarUrl: AV['Austin Lee'] },
  { value: '7291604705006895105', label: 'Kyle Chan',    avatarUrl: AV['Kyle Chan'] },
  { value: '6990536503940218908', label: 'Xuan Sheng',   avatarUrl: AV['Xuan Sheng'] },
  { value: '7405623196516450307', label: 'Tianyang Ni',  avatarUrl: AV['Tianyang Ni'] },
];
const SERVER_OWNERS: AvatarOption[] = [
  { value: '7210676945535778820', label: 'Austin Lee',   avatarUrl: AV['Austin Lee'] },
  { value: '7291604705006895105', label: 'Kyle Chan',    avatarUrl: AV['Kyle Chan'] },
  { value: '6990536503940218908', label: 'Xuan Sheng',   avatarUrl: AV['Xuan Sheng'] },
  { value: '7405623196516450307', label: 'Tianyang Ni',  avatarUrl: AV['Tianyang Ni'] },
];
const ANDROID_OWNERS: AvatarOption[] = [
  { value: '7210676945535778820', label: 'Austin Lee',  avatarUrl: AV['Austin Lee'] },
  { value: '6990536503940218908', label: 'Xuan Sheng',  avatarUrl: AV['Xuan Sheng'] },
];
const IOS_OWNERS: AvatarOption[] = [
  { value: 'baorishouaries',      label: 'Rishou Bao',  avatarUrl: AV['Rishou Bao'] },
  { value: '7226934680916967426', label: 'Kim Li',      avatarUrl: AV['Kim Li'] },
];
const UIUX_OWNERS: AvatarOption[] = [
  { value: '7205032929586593796', label: 'Tao Zhu',   avatarUrl: AV['Tao Zhu'] },
  { value: '7493184335885942785', label: 'Hazel Li',  avatarUrl: AV['Hazel Li'] },
];
const DA_OPTIONS: AvatarOption[] = [
  { value: '7107489609088647170', label: 'Lionel Lew', avatarUrl: AV['Lionel Lew'] },
];
const CONTENT_OPTIONS: AvatarOption[] = [
  { value: '7005856195756032028', label: 'Edward Lin', avatarUrl: AV['Edward Lin'] },
];
const QA_OPTIONS: AvatarOption[] = [
  { value: '7242202760668643331', label: 'Xiaobo Tian', avatarUrl: AV['Xiaobo Tian'] },
];
const PM_OPTIONS: AvatarOption[] = [
  { value: 'thomas.oefverstroem', label: 'Thomas', avatarUrl: AV['Thomas'] },
];

const TPM_OPTIONS: AvatarOption[] = [
  { value: '7330558724446191620', label: 'Spring Ren',  avatarUrl: AV['Spring Ren'] },
  { value: '7287415984883810308', label: 'Yunyi Yang',  avatarUrl: AV['Yunyi Yang'] },
];

const TIKTOK_PROJECT_KEY = '5f105019a8b9a853da64767f';

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-bold tracking-wide text-gray-400">{title}</h3>
  );
}

/** Shows a name with an optional avatar circle. Handles comma-separated multi-names. */
function AvatarInfoField({ label, value }: { label: string; value?: string }) {
  const names = value ? value.split(',').map(n => n.trim()).filter(Boolean) : [];
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
      {names.length === 0 ? (
        <span className="text-sm text-gray-200">—</span>
      ) : (
        <div className="flex flex-col gap-1 mt-0.5">
          {names.map(name => (
            <div key={name} className="flex items-center gap-1.5">
              <UserAvatar name={name} url={AV[name]} size={5} />
              <span className="text-sm text-gray-200">{name}</span>
            </div>
          ))}
        </div>
      )}
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

// ─── Create-form helpers ──────────────────────────────────────────────────────

function FormLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="text-[11px] text-gray-500 font-medium">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </span>
  );
}

const inputCls = 'w-full bg-[#13162a] border border-[#2e3460] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-gray-600';

// ─── Main component ───────────────────────────────────────────────────────────

export function FeatureModal({ mode, feature, onSave, onClose, onNodeCompleted, onFeatureCreated }: Props) {

  // ── Edit-mode state ──
  const [completing, setCompleting]       = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // ── Add-mode state ──
  const [form, setForm] = useState({
    name:            '',
    priority:        '1',           // P1 default
    quarterlyCycle:  '5350il55y',   // 2026-Q2 default
    businessLine:    '2hj6rn3ao',   // Social Messaging default
    socialComponent: 'mz8vxxems',   // Sticker & Typing Rec default
    pm:              '',
    techOwner:       '',
    server:          '',
    android:         '',
    ios:             '',
    uiux:            '',
    tpm:             TPM_OPTIONS[0].value,  // Spring Ren default
    da:              DA_OPTIONS[0].value,
    contentDesigner: CONTENT_OPTIONS[0].value,
    qa:              QA_OPTIONS[0].value,
  });
  const [prdBuilder, setPrdBuilder]         = useState(false);
  const [prdBuilderText, setPrdBuilderText] = useState('');
  const [prdType, setPrdType]               = useState<'regular' | 'halfday'>('regular');

  const isMeego     = !!(feature?.meegoUrl);
  const canComplete = feature?.canCompleteNode === true;
  const nodeName    = feature?.status ?? '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Default PM to the currently logged-in user
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then((d: { name?: string }) => {
        if (!d.name) return;
        const match = PM_OPTIONS.find(o => o.label === d.name || o.label === d.name!.split(' ')[0]);
        if (match) setForm(prev => ({ ...prev, pm: match.value }));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(key: keyof typeof form, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;

    const tempId   = `temp_${Date.now()}`;
    const priority = (PRIORITIES.find(p => p.id === form.priority)?.label ?? 'P1') as Priority;

    // Immediately close the modal and add the feature with a "Creating…" status
    onSave({
      id:              tempId,
      name:            form.name.trim(),
      description:     '',
      status:          'Creating…',
      priority,
      owner:           'Thomas',
      tasks:           [],
      lastUpdated:     new Date().toISOString().split('T')[0],
      meegoProjectKey: TIKTOK_PROJECT_KEY,
    });

    // Finish the API call in the background
    const roles: Array<{ role: string; owners: string[] }> = [
      { role: 'DA',          owners: [form.da] },
      { role: 'UX_Writer',   owners: [form.contentDesigner] },
      { role: 'QA',          owners: [form.qa] },
      { role: 'role_e8ce24', owners: [form.tpm] },
    ];
    if (form.pm)        roles.push({ role: 'PM',         owners: [form.pm] });
    if (form.techOwner) roles.push({ role: 'Tech_Owner', owners: [form.techOwner] });
    if (form.server)    roles.push({ role: 'Server',     owners: [form.server] });
    if (form.android)   roles.push({ role: 'Android',    owners: [form.android] });
    if (form.ios)       roles.push({ role: 'iOS',        owners: [form.ios] });
    if (form.uiux)      roles.push({ role: 'UI',         owners: [form.uiux] });

    fetch('/api/meego/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:                    form.name.trim(),
        priority,
        quarterlyCycleOptionId:  form.quarterlyCycle  || undefined,
        businessLineOptionId:    form.businessLine    || undefined,
        socialComponentOptionId: form.socialComponent || undefined,
        roles,
        prdBuilderText:          prdBuilder && prdBuilderText.trim() ? prdBuilderText.trim() : undefined,
        useHalfDayPrd:           prdBuilder && prdType === 'halfday' ? true : undefined,
      }),
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }: { ok: boolean; data: { id?: string; meegoUrl?: string; prd?: string; prdError?: string; error?: string } }) => {
        if (!ok) throw new Error(data.error ?? 'Create failed');
        if (data.prdError) {
          console.error('PRD creation failed:', data.prdError);
          toast.error(`PRD creation failed: ${data.prdError}`);
        }
        onFeatureCreated?.(tempId, {
          id:              data.id ?? tempId,
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
          prd:             data.prd,
        });
      })
      .catch(() => onFeatureCreated?.(tempId, null));
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
      toast.success(`"${feature.status}" marked as complete`);
      onNodeCompleted?.(feature.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to complete node';
      setCompleteError(msg);
      toast.error(msg);
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

          <div className="px-6 py-4 border-b border-[#1e2240] shrink-0 flex items-center justify-between">
            <h2 className="text-white font-semibold text-lg">New Feature</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleCreate} className="flex flex-col min-h-0 flex-1">
            <div className="px-6 py-5 flex flex-col gap-0 overflow-y-auto flex-1 divide-y divide-[#1e2240]">

              {/* Feature Name + PRD Builder */}
              <div className="pb-5 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <FormLabel required>Feature Name</FormLabel>
                  <div className="flex items-center gap-3">
                    <input autoFocus type="text" className={inputCls}
                      placeholder="Enter feature name…"
                      value={form.name} onChange={e => setField('name', e.target.value)} />
                    <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                      <input
                        type="checkbox"
                        checked={prdBuilder}
                        onChange={e => setPrdBuilder(e.target.checked)}
                        className="w-3.5 h-3.5 accent-blue-500 cursor-pointer"
                      />
                      <span className="text-[11px] text-gray-500 font-medium">PRD Builder</span>
                    </label>
                  </div>
                </div>

                {prdBuilder && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <FormLabel>Feature Description</FormLabel>
                      <textarea
                        className={`${inputCls} resize-none`}
                        rows={3}
                        placeholder="What are you building?"
                        value={prdBuilderText}
                        onChange={e => setPrdBuilderText(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FormLabel>PRD Type</FormLabel>
                      <CustomSelect
                        options={[
                          { value: 'regular', label: 'Regular PRD' },
                          { value: 'halfday', label: 'Half-Day PRD' },
                        ]}
                        value={prdType}
                        onChange={v => setPrdType(v as 'regular' | 'halfday')}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Feature Details */}
              <div className="py-5 flex flex-col gap-4">
                <SectionHeader title="Feature Details" />

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel required>Priority</FormLabel>
                    <CustomSelect options={PRIORITIES.map(p => ({ value: p.id, label: p.label }))} value={form.priority} onChange={v => setField('priority', v)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Quarterly Cycle</FormLabel>
                    <CustomSelect options={QUARTERLY_CYCLES.map(q => ({ value: q.id, label: q.label }))} value={form.quarterlyCycle} onChange={v => setField('quarterlyCycle', v)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Business Line</FormLabel>
                    <CustomSelect options={BUSINESS_LINES.map(b => ({ value: b.id, label: b.label }))} value={form.businessLine} onChange={v => setField('businessLine', v)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Social Component</FormLabel>
                    <CustomSelect options={SOCIAL_COMPONENTS.map(s => ({ value: s.id, label: s.label }))} value={form.socialComponent} onChange={v => setField('socialComponent', v)} />
                  </div>
                </div>
              </div>

              {/* POC Details */}
              <div className="pt-5 flex flex-col gap-4">
                <SectionHeader title="POC Details" />

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>PM</FormLabel>
                    <AvatarSelect options={PM_OPTIONS} value={form.pm} onChange={v => setField('pm', v)} placeholder="Optional" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>TPM</FormLabel>
                    <AvatarSelect options={TPM_OPTIONS} value={form.tpm} onChange={v => setField('tpm', v)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>UX Designer</FormLabel>
                    <AvatarSelect options={UIUX_OWNERS} value={form.uiux} onChange={v => setField('uiux', v)} placeholder="Optional" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Content Designer</FormLabel>
                    <AvatarSelect options={CONTENT_OPTIONS} value={form.contentDesigner} onChange={v => setField('contentDesigner', v)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>DS</FormLabel>
                    <AvatarSelect options={DA_OPTIONS} value={form.da} onChange={v => setField('da', v)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>QA</FormLabel>
                    <AvatarSelect options={QA_OPTIONS} value={form.qa} onChange={v => setField('qa', v)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Android</FormLabel>
                    <AvatarSelect options={ANDROID_OWNERS} value={form.android} onChange={v => setField('android', v)} placeholder="Optional" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>iOS</FormLabel>
                    <AvatarSelect options={IOS_OWNERS} value={form.ios} onChange={v => setField('ios', v)} placeholder="Optional" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Server</FormLabel>
                    <AvatarSelect options={SERVER_OWNERS} value={form.server} onChange={v => setField('server', v)} placeholder="Optional" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Tech Owner</FormLabel>
                    <AvatarSelect options={TECH_OWNERS} value={form.techOwner} onChange={v => setField('techOwner', v)} placeholder="Optional" />
                  </div>
                </div>
              </div>

            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#1e2240] shrink-0">
              <button type="button" onClick={onClose}
                className="px-5 py-2 bg-[#1e2240] text-gray-300 hover:text-white text-sm font-semibold rounded-lg transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={!form.name.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
                Create Feature
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
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
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

        <div className="px-6 py-5 flex flex-col gap-0 overflow-y-auto divide-y divide-[#1e2240]">

          <div className="pb-5">
            <SectionHeader title="Current Status" />
            <div className="mt-4">
            <InfoField label="Node" value={nodeName} />
            {isMeego && canComplete && (
              <div className="mt-3">
                <button onClick={handleCompleteNode} disabled={completing}
                  className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                  {completing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Completing…</>
                    : <>Complete: {nodeName} →</>}
                </button>
                {completeError && <p className="text-xs text-red-400 mt-1">{completeError}</p>}
              </div>
            )}
            {isMeego && feature?.canCompleteNode === false && (
              <p className="text-xs text-gray-600 mt-1">Not assigned to you</p>
            )}
            </div>
          </div>

          <div className="py-5">
            <SectionHeader title="Feature Details" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-4">
              <InfoField label="Priority"         value={feature?.priority} />
              <InfoField label="Business Line"    value={feature?.businessLine} />
              <InfoField label="Social Component" value={feature?.socialComponent} />
            </div>
          </div>

          <div className="pt-5">
            <SectionHeader title="POC Details" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-4">
              <AvatarInfoField label="PM"               value={feature?.pmOwner} />
              <AvatarInfoField label="TPM"              value={feature?.tpmOwner} />
              <AvatarInfoField label="UX Designer"      value={feature?.uiuxOwner} />
              <AvatarInfoField label="Content Designer" value={feature?.contentDesigner} />
              <AvatarInfoField label="DS"               value={feature?.daOwner} />
              <AvatarInfoField label="QA"               value={feature?.qaOwner} />
              <AvatarInfoField label="Android"          value={feature?.androidOwner} />
              <AvatarInfoField label="iOS"              value={feature?.iosOwner} />
              <AvatarInfoField label="Server"           value={feature?.serverOwner} />
              <AvatarInfoField label="Tech Owner"       value={feature?.techOwner} />
            </div>
          </div>

        </div>

        <div className="flex justify-end px-6 py-4 border-t border-[#1e2240] shrink-0">
          <button onClick={onClose}
            className="px-5 py-2 bg-[#1e2240] text-gray-300 hover:text-white text-sm font-semibold rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
