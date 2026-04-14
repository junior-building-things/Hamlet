'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { Feature } from '@/lib/types';

interface Link { label: string; url: string }
interface Msg { role: 'user' | 'assistant'; content: string; links?: Link[]; isWelcome?: boolean }
interface ChatResponse {
  reply: string;
  action?: string;
  feature?: Feature;
  links?: Link[];
  executing?: boolean;
  params?: Record<string, string>;
}

const WELCOME_MSG: Msg = {
  role: 'assistant',
  isWelcome: true,
  content:
    "I'm Hamlet, your helpful PM assistant. I can help you create features, edit PRDs, or update workflow nodes. How can I assist you with your project today?",
};

interface Props {
  onFeatureCreated?: (feature: Feature) => void;
}

export function ChatView({ onFeatureCreated }: Props) {
  // Seed with welcome so it's always the first message in the list
  const [messages, setMessages]     = useState<Msg[]>([WELCOME_MSG]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const containerRef                = useRef<HTMLDivElement>(null);
  const textareaRef                 = useRef<HTMLTextAreaElement>(null);

  // Load server-side history on mount; prepend welcome in front of any history
  useEffect(() => {
    fetch('/api/chat/history')
      .then(r => r.json())
      .then((data: { messages?: Msg[] }) => {
        if (data.messages && data.messages.length > 0) {
          setMessages([WELCOME_MSG, ...data.messages]);
        }
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, []);

  // Auto-scroll to bottom whenever messages or loading changes
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  async function saveToHistory(msgs: Msg[]) {
    try {
      await fetch('/api/chat/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs }),
      });
    } catch { /* best-effort */ }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    // Exclude the welcome message from the context snapshot sent to the API
    const snapshot = messages.filter(m => !m.isWelcome);

    const userMsg: Msg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // ── Phase 1: intent parsing (fast) ──────────────────────────────────────
      const res1  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: snapshot, userMessage: text }),
      });
      const data1 = await res1.json() as ChatResponse;

      const phase1Msg: Msg = { role: 'assistant', content: data1.reply };
      setMessages(prev => [...prev, phase1Msg]);

      if (data1.executing && data1.action && data1.params) {
        // ── Phase 2: execute action (slow) ────────────────────────────────────
        setLoading(true);
        const res2  = await fetch('/api/chat/execute', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: data1.action, params: data1.params }),
        });
        const data2 = await res2.json() as ChatResponse;

        const phase2Msg: Msg = {
          role:    'assistant',
          content: data2.reply,
          links:   data2.links,
        };
        setMessages(prev => [...prev, phase2Msg]);

        if (data2.action === 'create_feature' && data2.feature) {
          onFeatureCreated?.(data2.feature);
        }

        await saveToHistory([userMsg, phase1Msg, phase2Msg]);
      } else {
        // If there are links on the non-executing response, attach them
        if (data1.links?.length) {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], links: data1.links };
            return updated;
          });
        }
        await saveToHistory([userMsg, { ...phase1Msg, links: data1.links }]);
      }
    } catch (err) {
      console.error('[ChatView] Error:', err);
      const errMsg: Msg = { role: 'assistant', content: `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}` };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col" style={{ height: '100vh' }}>

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-7 pb-5 shrink-0 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl text-[var(--foreground)]" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Hamlet
          </h1>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-500">Online</span>
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">Your personal PM assistant</p>
      </div>

      {/* ── Messages ──────────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl flex flex-col gap-4">
          {!historyLoaded ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-700 text-[var(--foreground)] rounded-br-sm'
                    : 'bg-[var(--card-hover)] text-gray-200 rounded-bl-sm'
                }`}>
                  {msg.content}

                  {msg.links && msg.links.length > 0 && (
                    <div className="flex flex-wrap gap-3 mt-2.5 pt-2.5 border-t border-white/10">
                      {msg.links.map(l => (
                        <a
                          key={l.url}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-300 hover:text-blue-100 transition-colors"
                          style={{ textDecoration: 'none' }}
                        >
                          {l.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Typing indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[var(--card-hover)] px-4 py-3 rounded-2xl rounded-bl-sm">
                <div className="flex gap-1 items-center h-3">
                  {[0, 150, 300].map(d => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Input ─────────────────────────────────────────────────────────────── */}
      <div className="px-6 pb-8 pt-4 shrink-0 border-t border-[var(--border)]">
        <div className="max-w-2xl flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            rows={2}
            placeholder="Ask Hamlet anything…"
            disabled={loading}
            className="flex-1 bg-[var(--background)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] placeholder-gray-500 resize-none focus:outline-none focus:border-blue-600 transition-colors disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="p-3 bg-blue-700 text-[var(--foreground)] rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>
      </div>
    </div>
  );
}
