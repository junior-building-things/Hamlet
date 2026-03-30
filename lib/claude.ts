import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!client) {
    const authToken = process.env.CLAUDE_OAUTH_TOKEN;
    if (!authToken) throw new Error('CLAUDE_OAUTH_TOKEN not set');
    client = new Anthropic({ authToken });
  }
  return client;
}
