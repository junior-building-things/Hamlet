'use client';
import { useEffect, useState } from 'react';
import { Feature, Priority } from '@/lib/types';
import { X, Loader2, CheckCircle2, WandSparkles } from 'lucide-react';
import Image from 'next/image';
import { toast } from 'sonner';
import { AvatarSelect, CustomSelect, AvatarOption, UserAvatar } from './AvatarSelect';
import { PackageModal } from './PackageModal';
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
  { id: 'xg717kfyx', label: '2025-Q4' },
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
  { id: 'mz8vxxems',              label: 'Sticker & Avatar' },
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
  { id: 'zv2r55744',              label: 'Comment' },
  { id: 'bw5j80hmq',              label: 'Push & Notification' },
  { id: 'jhix081_e',              label: 'Like' },
  { id: 'fvbm2kzw5',              label: 'Repost' },
  { id: '1rwknvism',              label: 'Story' },
  { id: '1bwnkchqi',              label: 'Friends Tab' },
  { id: 'o_sqx0771',              label: 'Following Tab' },
  { id: 'vgrfiylba',              label: 'Social Creation' },
  { id: 'svc51kfyq',              label: 'Mention' },
  { id: '8ychm5sq1',              label: 'Game' },
  { id: '_8s_m0nt8',              label: 'Cross Team' },
  { id: '66c4cc75o',              label: 'Profile Viewer' },
  { id: 'km7q6q0j4',              label: 'Collab' },
  { id: 'Comment Platform',       label: 'Comment Platform' },
  { id: 'f5kfva7cc',              label: 'Interest Graph' },
  { id: 'i5f7lqne5',              label: 'Compliance/External' },
  { id: '4ikv9_1th',              label: 'Campus' },
  { id: 'Gamification',           label: 'Gamification' },
  { id: '9iet2d_lf',              label: 'Client Platformization' },
  { id: 'ealmxb07n',              label: 'Whee 3.0' },
  { id: 'wlqq2bu03',              label: 'Sora 1.0' },
  { id: 'Real time Communication', label: 'Real time Communication' },
  { id: 's_kvfq_uz',              label: 'Text Mode' },
  { id: '8aaoei2jk',              label: 'FYP/Fullpage-Photo Mode' },
  { id: '5iqcrp5u9',              label: 'Double Column' },
  { id: '8my6m3q7x',              label: 'Interest Community' },
  { id: 'qvid_2qez',              label: 'Info Graphic & Text' },
  { id: 'e0087agcz',              label: 'Foundation' },
  { id: '7179p9d_n',              label: 'Photo-Text Feature' },
  { id: 'pbpg1jn5m',              label: 'Standalone App (history)' },
  { id: 'vrc2x3l2i',              label: 'Counter' },
  { id: 'i_6pj4ua3',              label: 'Social Sort' },
  { id: '_o5lg5h7o',              label: 'Collab' },
  { id: '2y6v0lv_i',              label: 'Photo-Text Standalone' },
  { id: 'zvmpr6qqk',              label: 'Now App' },
  { id: 'kdy9b7vww',              label: 'Now' },
  { id: 'cjvllclrm',              label: 'Profile' },
];

// Role members with keys + avatars. Helper to look up the avatar URL fresh
// from the AV map at call time (the map is populated dynamically as features
// sync — defining options at module load would bake in undefined avatars).
const opt = (value: string, label: string): AvatarOption => ({ value, label, avatarUrl: AV[label] });

const TECH_OWNERS = (): AvatarOption[] => [
  opt('7210676945535778820', 'Austin Lee'),
  opt('7291604705006895105', 'Kyle Chan'),
  opt('6990536503940218908', 'Xuan Sheng'),
  opt('7405623196516450307', 'Tianyang Ni'),
];
const SERVER_OWNERS = (): AvatarOption[] => [
  opt('7210676945535778820', 'Austin Lee'),
  opt('7291604705006895105', 'Kyle Chan'),
  opt('6990536503940218908', 'Xuan Sheng'),
  opt('7405623196516450307', 'Tianyang Ni'),
  opt('jinming.zhang', 'Jinming Zhang'),
];
const ANDROID_OWNERS = (): AvatarOption[] => [
  opt('7210676945535778820', 'Austin Lee'),
  opt('6990536503940218908', 'Xuan Sheng'),
];
const IOS_OWNERS = (): AvatarOption[] => [
  opt('baorishouaries', 'Rishou Bao'),
  opt('7226934680916967426', 'Kim Li'),
];
const UIUX_OWNERS = (): AvatarOption[] => [
  opt('7205032929586593796', 'Tao Zhu'),
  opt('7493184335885942785', 'Hazel Li'),
];
const DA_OPTIONS = (): AvatarOption[] => [
  opt('7107489609088647170', 'Lionel Lew'),
];
const CONTENT_OPTIONS = (): AvatarOption[] => [
  opt('7005856195756032028', 'Edward Lin'),
];
const QA_OPTIONS = (): AvatarOption[] => [
  opt('7242202760668643331', 'Xiaobo Tian'),
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
        <span className="text-sm text-[var(--foreground)]">—</span>
      ) : (
        <div className="flex flex-col gap-1 mt-0.5">
          {names.map(name => (
            <div key={name} className="flex items-center gap-1.5">
              <UserAvatar name={name} url={AV[name]} size={5} />
              <span className="text-sm text-[var(--foreground)]">{name}</span>
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
      <span className="text-sm text-[var(--foreground)]">{value || '—'}</span>
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

const inputCls = 'w-full bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 placeholder-gray-600';

// ─── Main component ───────────────────────────────────────────────────────────

export function FeatureModal({ mode, feature: featureProp, onSave, onClose, onNodeCompleted, onFeatureCreated }: Props) {

  // ── Edit-mode state ──
  const [completing, setCompleting]       = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [creating,    setCreating]    = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // After a successful create we stash the full Feature here and
  // SHADOW the `feature` prop with it. That way the edit-mode JSX
  // below renders the just-created feature exactly the same as it
  // would for an existing one — links, status, all the field
  // sections — no need to teach the add view about edit content.
  const [createdFeature, setCreatedFeature] = useState<Feature | null>(null);
  const feature = createdFeature ?? featureProp;
  const [showPackages, setShowPackages] = useState(false);

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
    da:              DA_OPTIONS()[0].value,
    contentDesigner: CONTENT_OPTIONS()[0].value,
    qa:              QA_OPTIONS()[0].value,
  });
  const [prdType, setPrdType]               = useState<'regular' | 'halfday'>('regular');
  const [featureDescription, setFeatureDescription] = useState('');
  const [rewritingName, setRewritingName]           = useState(false);
  const [rewritingDesc, setRewritingDesc]           = useState(false);

  async function handleRewrite(field: 'name' | 'description') {
    const text = field === 'name' ? form.name : featureDescription;
    if (!text.trim()) return;
    const setSpin = field === 'name' ? setRewritingName : setRewritingDesc;
    setSpin(true);
    try {
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, field }),
      });
      const data = await res.json() as { rewritten?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Rewrite failed');
      if (data.rewritten) {
        if (field === 'name') setField('name', data.rewritten);
        else setFeatureDescription(data.rewritten);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rewrite failed');
    } finally {
      setSpin(false);
    }
  }

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;

    const priority = (PRIORITIES.find(p => p.id === form.priority)?.label ?? 'P1') as Priority;
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

    setCreating(true);
    setCreateError(null);
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
          businessLineLabel:       BUSINESS_LINES.find(b => b.id === form.businessLine)?.label,
          socialComponentLabel:    SOCIAL_COMPONENTS.find(s => s.id === form.socialComponent)?.label,
          roles,
          featureDescription:      featureDescription.trim() || undefined,
          useHalfDayPrd:           prdType === 'halfday' ? true : undefined,
        }),
      });
      const data = await res.json() as { id?: string; meegoUrl?: string; prd?: string; prdError?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Create failed');
      if (data.prdError) {
        console.error('PRD creation failed:', data.prdError);
        toast.error(`PRD creation failed: ${data.prdError}`);
      }
      // Look up the human-readable label for each selected option so the
      // post-create modal renders Project Details / POC Details exactly
      // like the "click an existing feature" view (which gets these
      // populated from cached data).
      const lookup = (opts: AvatarOption[], val: string) =>
        opts.find(o => o.value === val)?.label;
      const newFeature: Feature = {
        id:              data.id ?? `feature_${Date.now()}`,
        name:            form.name.trim(),
        description:     '',
        status:          'PRD/Design Prep',
        priority,
        owner:           'Thomas',
        tasks:           [],
        lastUpdated:     new Date().toISOString().split('T')[0],
        meegoUrl:        data.meegoUrl,
        meegoIssueId:    data.id,
        meegoProjectKey: TIKTOK_PROJECT_KEY,
        prd:             data.prd,
        quarterlyCycle:  QUARTERLY_CYCLES.find(q => q.id === form.quarterlyCycle)?.label,
        businessLine:    BUSINESS_LINES.find(b => b.id === form.businessLine)?.label,
        socialComponent: SOCIAL_COMPONENTS.find(s => s.id === form.socialComponent)?.label,
        pmOwner:         lookup(PM_OPTIONS, form.pm),
        tpmOwner:        lookup(TPM_OPTIONS, form.tpm),
        uiuxOwner:       lookup(UIUX_OWNERS(), form.uiux),
        contentDesigner: lookup(CONTENT_OPTIONS(), form.contentDesigner),
        daOwner:         lookup(DA_OPTIONS(), form.da),
        qaOwner:         lookup(QA_OPTIONS(), form.qa),
        androidOwner:    lookup(ANDROID_OWNERS(), form.android),
        iosOwner:        lookup(IOS_OWNERS(), form.ios),
        serverOwner:     lookup(SERVER_OWNERS(), form.server),
        techOwner:       lookup(TECH_OWNERS(), form.techOwner),
      };
      onSave(newFeature);
      setCreatedFeature(newFeature);
      toast.success(`"${form.name.trim()}" created`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      setCreateError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
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

  // Add mode: show the form until the create succeeds; once it does,
  // `createdFeature` is set and we fall through to the edit-mode UI
  // (which uses `feature`, now shadowed by createdFeature).
  if (mode === 'add' && !createdFeature) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-[var(--background)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">

          <div className="px-6 py-4 border-b border-[var(--border)] shrink-0 flex items-center justify-between">
            <h2 className="text-[var(--foreground)] font-semibold text-lg">New Feature</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-[var(--foreground)] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleCreate} className="flex flex-col min-h-0 flex-1">
            <div className="px-6 py-5 flex flex-col gap-0 overflow-y-auto flex-1 divide-y divide-[var(--border)]">

              {/* PRD Details */}
              <div className="pb-5 flex flex-col gap-4">
                <SectionHeader title="PRD Details" />

                <div className="flex flex-col gap-1.5">
                  <FormLabel required>PRD Type</FormLabel>
                  <CustomSelect
                    options={[
                      { value: 'regular', label: 'Regular PRD' },
                      { value: 'halfday', label: 'Half-Day PRD' },
                    ]}
                    value={prdType}
                    onChange={v => setPrdType(v as 'regular' | 'halfday')}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <FormLabel required>PRD Name</FormLabel>
                  <div className="flex items-center gap-2">
                    <input autoFocus type="text" className={inputCls}
                      placeholder="Enter PRD name…"
                      value={form.name} onChange={e => setField('name', e.target.value)} />
                    <button type="button" disabled={!form.name.trim() || rewritingName}
                      onClick={() => handleRewrite('name')}
                      className="shrink-0 p-2 rounded-lg border border-[var(--border)] text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:text-purple-400 enabled:hover:border-purple-500/50">
                      {rewritingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <WandSparkles className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <FormLabel>PRD Description</FormLabel>
                  <div className="flex items-start gap-2">
                    <textarea
                      className={`${inputCls} resize-none`}
                      rows={3}
                      placeholder="What are we building?"
                      value={featureDescription}
                      onChange={e => setFeatureDescription(e.target.value)}
                    />
                    <button type="button" disabled={!featureDescription.trim() || rewritingDesc}
                      onClick={() => handleRewrite('description')}
                      className="shrink-0 p-2 rounded-lg border border-[var(--border)] text-gray-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:text-purple-400 enabled:hover:border-purple-500/50 mt-1">
                      {rewritingDesc ? <Loader2 className="w-4 h-4 animate-spin" /> : <WandSparkles className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Project Details */}
              <div className="py-5 flex flex-col gap-4">
                <SectionHeader title="Project Details" />

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
                    <AvatarSelect options={UIUX_OWNERS()} value={form.uiux} onChange={v => setField('uiux', v)} placeholder="Optional" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Content Designer</FormLabel>
                    <AvatarSelect options={CONTENT_OPTIONS()} value={form.contentDesigner} onChange={v => setField('contentDesigner', v)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>DS</FormLabel>
                    <AvatarSelect options={DA_OPTIONS()} value={form.da} onChange={v => setField('da', v)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>QA</FormLabel>
                    <AvatarSelect options={QA_OPTIONS()} value={form.qa} onChange={v => setField('qa', v)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Android</FormLabel>
                    <AvatarSelect options={ANDROID_OWNERS()} value={form.android} onChange={v => setField('android', v)} placeholder="Optional" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>iOS</FormLabel>
                    <AvatarSelect options={IOS_OWNERS()} value={form.ios} onChange={v => setField('ios', v)} placeholder="Optional" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Server</FormLabel>
                    <AvatarSelect options={SERVER_OWNERS()} value={form.server} onChange={v => setField('server', v)} placeholder="Optional" dropUp />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormLabel>Tech Owner</FormLabel>
                    <AvatarSelect options={TECH_OWNERS()} value={form.techOwner} onChange={v => setField('techOwner', v)} placeholder="Optional" dropUp />
                  </div>
                </div>
              </div>

            </div>

            {createError && (
              <div className="px-6 pt-2 pb-0 shrink-0">
                <p className="text-xs text-red-500 mb-2">{createError}</p>
              </div>
            )}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border)] shrink-0">
              <button type="button" onClick={onClose} disabled={creating}
                className="px-5 py-2 bg-[var(--card-hover)] text-[var(--foreground)] hover:opacity-80 disabled:opacity-50 text-sm font-semibold rounded-lg transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={!form.name.trim() || creating}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2">
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {creating ? 'Creating…' : 'Create Feature'}
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
      <div className="relative bg-[var(--background)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">

        <div className="px-6 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[var(--foreground)] font-semibold text-lg leading-snug pr-2">
              {feature?.name ?? 'Feature'}
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-[var(--foreground)] transition-colors shrink-0 mt-0.5">
              <X className="w-5 h-5" />
            </button>
          </div>
          {isMeego && (
            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
              <a href={feature?.meegoUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs flex items-center gap-1 hover:brightness-125 transition-all" style={{ color: '#B291F7' }}>
                <Image src="/meego.png" alt="" width={16} height={16} className="shrink-0" /> Meego
              </a>
              {feature?.prd && (
                <a href={feature.prd} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors">
                  <Image src="/prd.png" alt="" width={14} height={14} className="shrink-0" /> PRD
                </a>
              )}
              {feature?.complianceUrl && (
                <a href={feature.complianceUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 hover:brightness-125 transition-all" style={{ color: '#88DBDD' }}>
                  <Image src="/compliance.png" alt="" width={14} height={14} className="shrink-0" /> Compliance
                </a>
              )}
              {feature?.figmaUrl && (
                <a href={feature.figmaUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 hover:brightness-125 transition-all" style={{ color: '#FF7362' }}>
                  <Image src="/figma.svg" alt="" width={10} height={14} className="shrink-0" /> Figma
                </a>
              )}
              {feature?.libraUrl && (
                <a href={feature.libraUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 hover:brightness-125 transition-all" style={{ color: '#0073F0' }}>
                  <Image src="/libra.png" alt="" width={14} height={14} className="shrink-0" /> Libra
                </a>
              )}
              {feature?.abReportUrl && (
                <a href={feature.abReportUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 hover:brightness-125 transition-all" style={{ color: '#108453' }}>
                  <Image src="/abreport.png" alt="" width={14} height={14} className="shrink-0" /> AB Report
                </a>
              )}
              {(feature?.packageQrUrl || feature?.iosPackageQrUrl) && (
                <button type="button" onClick={() => setShowPackages(true)}
                  className="text-xs text-[var(--foreground)] hover:brightness-125 flex items-center gap-1 transition-all">
                  <Image src="/qr.svg" alt="" width={14} height={14} className="shrink-0" /> Packages
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-5 flex flex-col gap-0 overflow-y-auto divide-y divide-[var(--border)]">

          <div className="pb-5">
            <SectionHeader title="Current Status" />
            <div className="mt-4">
            <InfoField label="Node" value={nodeName} />
            {isMeego && canComplete && (
              <div className="mt-3">
                <button onClick={handleCompleteNode} disabled={completing}
                  className="flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
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
            <SectionHeader title="Project Details" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-4">
              <InfoField label="Priority"         value={feature?.priority} />
              <InfoField label="Quarterly Cycle"  value={feature?.quarterlyCycle} />
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
            {(() => {
              // "Other POCs" — names appearing in pocEmails but not in any of
              // the canonical 10 role fields above (e.g. Apple BD, Privacy BP,
              // Localization, Line Master, Security QA). De-dupe by first name.
              if (!feature?.pocEmails) return null;
              const claimed = new Set<string>();
              const claim = (val?: string) => {
                if (!val) return;
                for (const n of val.split(',').map(n => n.trim()).filter(Boolean)) {
                  const first = n.split(/\s+/)[0];
                  if (first) claimed.add(first);
                }
              };
              claim(feature.pmOwner); claim(feature.tpmOwner); claim(feature.uiuxOwner);
              claim(feature.contentDesigner); claim(feature.daOwner); claim(feature.qaOwner);
              claim(feature.androidOwner); claim(feature.iosOwner); claim(feature.serverOwner);
              claim(feature.techOwner);
              const others = Object.keys(feature.pocEmails).filter(name => !claimed.has(name));
              if (others.length === 0) return null;
              return (
                <div className="mt-4">
                  <span className="text-[11px] text-gray-500 font-medium">Other POCs</span>
                  <div className="flex flex-col gap-1 mt-1">
                    {others.map(name => (
                      <div key={name} className="flex items-center gap-1.5">
                        <UserAvatar name={name} url={AV[name]} size={5} />
                        <span className="text-sm text-[var(--foreground)]">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

        </div>

        <div className="flex justify-end px-6 py-4 border-t border-[var(--border)] shrink-0">
          <button onClick={onClose}
            className="px-5 py-2 bg-[var(--card-hover)] text-[var(--foreground)] hover:opacity-80 text-sm font-semibold rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>

      {showPackages && feature && (feature.packageQrUrl || feature.iosPackageQrUrl) && (
        <PackageModal
          androidQrUrl={feature.packageQrUrl}
          androidDownloadUrl={feature.packageDownloadUrl}
          androidPackageName={feature.packageName}
          androidBuildTime={feature.packageBuildTime}
          iosQrUrl={feature.iosPackageQrUrl}
          iosDownloadUrl={feature.iosPackageDownloadUrl}
          iosPackageName={feature.iosPackageName}
          iosBuildTime={feature.iosPackageBuildTime}
          featureName={feature.name}
          defaultTab={feature.iosPackageQrUrl && !feature.packageQrUrl ? 'ios' : 'android'}
          onClose={() => setShowPackages(false)}
        />
      )}
    </div>
  );
}
