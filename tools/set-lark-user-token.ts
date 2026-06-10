/**
 * One-shot: re-seed the Lark user refresh token used by the digest
 * pipeline (GCS `state.larkUserRefreshToken`).
 *
 * The Lark user refresh token is single-use and rotates on every refresh.
 * When two consumers share one Lark grant via different stores (the digest
 * pipeline via GCS, download-lark-docs via .env.local), they invalidate
 * each other and the GCS-stored token can end up dead — the pipeline then
 * logs `20026 refresh token is invalid` and falls back to the bot token.
 *
 * This script takes a known-good refresh token (argv[2], else .env.local's
 * LARK_USER_REFRESH_TOKEN), refreshes it once to prove validity + get a
 * fresh rotated token, and writes that rotated token into BOTH GCS state
 * and .env.local so the two stores realign.
 *
 * Get a fresh token by logging into Hamlet and GET /api/auth/refresh-token.
 *
 * Run:
 *   npx tsx tools/set-lark-user-token.ts [refresh_token]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_PATH = resolve(process.cwd(), '.env.local');

async function loadDotEnv(): Promise<void> {
  if (!existsSync(ENV_PATH)) return;
  const text = await readFile(ENV_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

async function persistEnv(token: string): Promise<void> {
  if (!existsSync(ENV_PATH)) return;
  const txt = await readFile(ENV_PATH, 'utf8');
  const replaced = /^LARK_USER_REFRESH_TOKEN=/m.test(txt)
    ? txt.replace(/^LARK_USER_REFRESH_TOKEN=.*$/m, `LARK_USER_REFRESH_TOKEN=${token}`)
    : `${txt.replace(/\s*$/, '')}\nLARK_USER_REFRESH_TOKEN=${token}\n`;
  await writeFile(ENV_PATH, replaced);
}

async function main(): Promise<void> {
  await loadDotEnv();
  const seed = process.argv[2] || process.env.LARK_USER_REFRESH_TOKEN;
  if (!seed) {
    console.error('[set-lark-user-token] no token — pass one as argv or set LARK_USER_REFRESH_TOKEN in .env.local');
    process.exit(1);
  }

  const { refreshUserToken } = await import('../lib/lark');
  const result = await refreshUserToken(seed);
  if (!result) {
    console.error(
      '[set-lark-user-token] seed token is dead. Log into Hamlet, open ' +
      '/api/auth/refresh-token, copy `larkRefreshToken`, and re-run:\n' +
      '  npx tsx tools/set-lark-user-token.ts <token>',
    );
    process.exit(1);
  }

  const { loadDigestState, saveDigestState } = await import('../lib/digest-state');
  const state = await loadDigestState();
  state.larkUserRefreshToken = result.refreshToken;
  await saveDigestState(state);
  await persistEnv(result.refreshToken);

  console.log('[set-lark-user-token] reseeded GCS state.larkUserRefreshToken + .env.local with a fresh rotated token.');
}

main().catch(e => {
  console.error('[set-lark-user-token] fatal:', e);
  process.exit(1);
});
