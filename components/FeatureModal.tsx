'use client';
import { useState, useEffect } from 'react';
import { Feature, Status, Priority, Task } from '@/lib/types';
import { X, Plus, Trash2, Link } from 'lucide-react';

const STATUSES: Status[] = ['Discovery', 'Design', 'Development', 'AB Testing', 'Launched', 'On Hold'];
const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];

interface Props {
  mode: 'add' | 'edit';
  feature?: Feature;
  onSave: (feature: Feature) => void;
  onClose: () => void;
}

export function FeatureModal({ mode, feature, onSave, onClose }: Props) {
  const [name, setName]             = useState(feature?.name ?? '');
  const [description, setDesc]      = useState(feature?.description ?? '');
  const [status, setStatus]         = useState<Status>(feature?.status ?? 'Discovery');
  const [priority, setPriority]     = useState<Priority>(feature?.priority ?? 'Medium');
  const [owner, setOwner]           = useState(feature?.owner ?? '');
  const [tasks, setTasks]           = useState<Task[]>(feature?.tasks ?? []);
  const [newTaskText, setNewTask]   = useState('');
  const [meegoUrl, setMeegoUrl]     = useState(feature?.meegoUrl ?? '');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSave() {
    if (!name.trim()) return;
    const now = new Date().toISOString().split('T')[0];

    // Parse meegoUrl to extract project key and issue ID
    let meegoProjectKey: string | undefined;
    let meegoIssueId: string | undefined;
    if (meegoUrl) {
      const match = meegoUrl.match(/meego\.larkoffice\.com\/([^/]+)\/story\/detail\/(\d+)/);
      if (match) {
        meegoProjectKey = match[1];
        meegoIssueId = match[2];
      }
    }

    onSave({
      id: feature?.id ?? `local-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      status,
      priority,
      owner: owner.trim(),
      tasks,
      lastUpdated: now,
      meegoUrl: meegoUrl.trim() || undefined,
      meegoProjectKey,
      meegoIssueId,
    });
  }

  function addTask() {
    if (!newTaskText.trim()) return;
    setTasks(prev => [...prev, { id: `t-${Date.now()}`, text: newTaskText.trim(), completed: false }]);
    setNewTask('');
  }

  function toggleTask(id: string) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  }

  function removeTask(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0e1120] border border-[#1e2240] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2240]">
          <h2 className="text-white font-semibold text-lg">
            {mode === 'add' ? 'Add Feature' : 'Edit Feature'}
          </h2>
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

          {/* Description */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDesc(e.target.value)}
              placeholder="Describe the feature..."
              rows={3}
              className="w-full bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-600 transition-colors resize-none"
            />
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1.5">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as Status)}
                className="w-full bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-600 cursor-pointer"
              >
                {STATUSES.map(s => <option key={s} value={s} className="bg-[#13162a]">{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 font-medium block mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as Priority)}
                className="w-full bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-600 cursor-pointer"
              >
                {PRIORITIES.map(p => <option key={p} value={p} className="bg-[#13162a]">{p}</option>)}
              </select>
            </div>
          </div>

          {/* Owner */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1.5">Owner (POC)</label>
            <input
              type="text"
              value={owner}
              onChange={e => setOwner(e.target.value)}
              placeholder="e.g. Thomas"
              className="w-full bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-600 transition-colors"
            />
          </div>

          {/* Meego URL */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-1.5">
              <span className="flex items-center gap-1"><Link className="w-3 h-3" />Meego Story URL</span>
            </label>
            <input
              type="url"
              value={meegoUrl}
              onChange={e => setMeegoUrl(e.target.value)}
              placeholder="https://meego.larkoffice.com/tiktok/story/detail/..."
              className="w-full bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-600 transition-colors"
            />
            <p className="text-xs text-gray-600 mt-1">Link to sync status automatically from Meego</p>
          </div>

          {/* Tasks */}
          <div>
            <label className="text-xs text-gray-400 font-medium block mb-2">Tasks</label>
            <div className="flex flex-col gap-1.5 mb-2">
              {tasks.map(task => (
                <div key={task.id} className="flex items-center gap-2 group">
                  <button onClick={() => toggleTask(task.id)}
                    className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${task.completed ? 'bg-emerald-600 border-emerald-600' : 'border-gray-600 hover:border-gray-400'}`}>
                    {task.completed && <span className="text-white text-[9px]">✓</span>}
                  </button>
                  <span className={`text-sm flex-1 ${task.completed ? 'line-through text-gray-600' : 'text-gray-300'}`}>{task.text}</span>
                  <button onClick={() => removeTask(task.id)}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTaskText}
                onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTask()}
                placeholder="Add a task..."
                className="flex-1 bg-[#13162a] border border-[#1e2240] rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-purple-600 transition-colors"
              />
              <button onClick={addTask}
                className="flex items-center gap-1 bg-[#1e2240] text-gray-300 hover:text-white px-3 py-1.5 rounded-lg text-sm transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#1e2240]">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!name.trim()}
            className="px-5 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {mode === 'add' ? 'Add Feature' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
