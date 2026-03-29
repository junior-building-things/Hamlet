export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  links?: { label: string; url: string }[];
}

// Module-level store — persists across requests within the same server process.
// On Vercel, this persists for the lifetime of a warm Lambda instance.
const store = new Map<string, ChatMsg[]>();

export function getHistory(userId: string): ChatMsg[] {
  return store.get(userId) ?? [];
}

export function appendMessages(userId: string, msgs: ChatMsg[]): void {
  const prev = store.get(userId) ?? [];
  // Cap at 400 messages to prevent unbounded growth
  const next = [...prev, ...msgs].slice(-400);
  store.set(userId, next);
}
