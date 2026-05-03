'use client';
import { useState, useRef, useEffect } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { Feature } from '@/lib/types';

const SUGGESTIONS = [
  'Summarize this week\'s PRD changes',
  'Which features are at risk?',
  'Show me my To Dos',
  'What\'s blocking line review?',
];

/** Render a chat-bubble line — supports **bold** segments. */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<strong key={parts.length}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

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
    <div className="chat-shell h-full">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-2.5">
          <div className="text-[18px] font-semibold text-[var(--text)] tracking-[-0.02em]">Chat with Junior</div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ai)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ai)] animate-pulse shadow-[0_0_8px_var(--ai-glow)]" />
            Online
          </span>
        </div>
        <div className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Ask about ongoing projects, draft updates, or kick off a new feature.
        </div>
      </div>

      {/* ── Messages ──────────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="chat-scroll">
        <div className="chat-stream">
          {!historyLoaded ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--ai)]" />
            </div>
          ) : (
            messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div key={i} className={`chat-msg ${isUser ? 'user' : 'junior'}`}>
                  <div className={`chat-avatar ${isUser ? 'user' : 'junior'}`}>
                    {isUser ? 'TS' : <Sparkles className="w-2.5 h-2.5" />}
                  </div>
                  <div className="chat-bubble-wrap">
                    <div className="chat-name">
                      {isUser ? 'You' : 'Junior'}
                      <span className="chat-time"> · {isUser ? 'now' : 'reply'}</span>
                    </div>
                    <div className={`chat-bubble ${isUser ? 'user' : 'junior'}`}>
                      {msg.content.split('\n').map((line, j) => (
                        <div key={j}>{renderInline(line) as React.ReactNode}</div>
                      ))}
                    </div>
                    {msg.links && msg.links.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {msg.links.map(l => (
                          <a
                            key={l.url}
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 h-6 px-2 rounded-[var(--r-sm)] bg-[var(--bg-elev-2)] border border-[var(--hairline)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--hairline-strong)] text-[10.5px] transition-colors"
                          >
                            {l.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Typing indicator */}
          {loading && (
            <div className="chat-msg junior">
              <div className="chat-avatar junior">
                <Sparkles className="w-2.5 h-2.5" />
              </div>
              <div className="chat-bubble-wrap">
                <div className="chat-name">
                  Junior <span className="chat-time">· thinking</span>
                </div>
                <div className="chat-bubble junior">
                  <div className="chat-typing"><span /><span /><span /></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Composer ─────────────────────────────────────────────────────────── */}
      <div className="chat-composer">
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            rows={1}
            placeholder="Ask Junior anything…"
            disabled={loading}
            className="chat-input"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--r-sm)] text-[12px] transition-colors disabled:opacity-50 shrink-0"
            style={{
              background: 'var(--ai-soft)',
              color: 'var(--ai)',
              border: '1px solid oklch(0.82 0.14 var(--ai-h) / 0.3)',
            }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Send
          </button>
        </div>
        <div className="chat-suggestions">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              type="button"
              className="chat-suggestion"
              onClick={() => { setInput(s); textareaRef.current?.focus(); }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
