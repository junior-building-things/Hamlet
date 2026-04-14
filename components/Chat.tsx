'use client';
import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { Feature } from '@/lib/types';


interface Link { label: string; url: string }
interface Msg { role: 'user' | 'assistant'; content: string; links?: Link[] }
interface ChatResponse { reply: string; action?: string; feature?: Feature; links?: Link[] }

interface Props {
  onFeatureCreated?: (feature: Feature) => void;
}

export function Chat({ onFeatureCreated }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const containerRef            = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const snapshot = [...messages];
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: snapshot, userMessage: text }),
      });
      const data = await res.json() as ChatResponse;
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, links: data.links }]);
      if (data.action === 'create_feature' && data.feature) {
        onFeatureCreated?.(data.feature);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-6 pt-6 pb-4">
      <h2 className="text-3xl text-[var(--foreground)] mb-5" style={{ fontFamily: 'var(--font-newsreader)' }}>
        I&apos;m Hamlet, your personal feature assistant 👋
      </h2>

      {/* Message history — grows up to max-h-48, scrolls internally (no page scroll) */}
      <div ref={containerRef} className="w-1/2 max-h-48 overflow-y-auto pr-1 mb-2">
        <div className="flex flex-col gap-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-700 text-[var(--foreground)] rounded-br-sm'
                  : 'bg-[var(--card-hover)] text-gray-200 rounded-bl-sm'
              }`}>
                {msg.content}
                {msg.links && msg.links.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-white/10">
                    {msg.links.map(l => (
                      <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                        className="text-blue-300 underline underline-offset-2 hover:text-blue-100 transition-colors">
                        {l.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-[var(--card-hover)] px-4 py-3 rounded-2xl rounded-bl-sm">
                <div className="flex gap-1 items-center h-3">
                  {[0, 150, 300].map(d => (
                    <span key={d} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input row — 50% width, left-aligned */}
      <div className="flex gap-2 items-end w-1/2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={2}
          placeholder="You can ask me to create new features, or follow up on the progress of ongoing features"
          disabled={loading}
          className="flex-1 bg-[var(--background)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] placeholder-gray-500 resize-none focus:outline-none focus:border-blue-600 transition-colors disabled:opacity-60"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="p-3 bg-blue-700 text-[var(--foreground)] rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
