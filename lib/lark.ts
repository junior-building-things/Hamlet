const LARK_BASE_URL   = process.env.LARK_BASE_URL ?? 'https://open.larksuite.com';
const TEMPLATE_TOKEN  = 'Z5qldS3kEoC1WAxPyMucR9RpneX';

// ─── Token cache ──────────────────────────────────────────────────────────────

let cachedToken    = '';
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const appId     = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error('LARK_APP_ID / LARK_APP_SECRET not configured');

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0) throw new Error(`Lark auth error ${data.code}: ${data.msg}`);

  cachedToken    = data.tenant_access_token!;
  tokenExpiresAt = Date.now() + (data.expire ?? 7200) * 1000;
  return cachedToken;
}

// ─── Root folder ──────────────────────────────────────────────────────────────

let cachedRootFolder    = '';
let rootFolderFetchedAt = 0;

async function getRootFolderToken(accessToken: string): Promise<string> {
  // Cache for 1 hour — it never changes
  if (cachedRootFolder && Date.now() - rootFolderFetchedAt < 3_600_000) return cachedRootFolder;

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/drive/explorer/v2/root_folder/meta`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json() as { code: number; msg?: string; data?: { token: string } };
  if (data.code !== 0) throw new Error(`Lark root folder error ${data.code}: ${data.msg}`);

  cachedRootFolder    = data.data!.token;
  rootFolderFetchedAt = Date.now();
  return cachedRootFolder;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Copies the PRD template into the bot's root folder, naming it after the feature.
 * Returns the URL of the newly created document.
 */
export async function copyPrdTemplate(featureName: string): Promise<string> {
  const token       = await getAccessToken();
  const folderToken = await getRootFolderToken(token);

  const res  = await fetch(`${LARK_BASE_URL}/open-apis/drive/v1/files/${TEMPLATE_TOKEN}/copy`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: featureName, type: 'docx', folder_token: folderToken }),
  });
  const data = await res.json() as {
    code: number; msg?: string;
    data?: { file?: { token?: string; url?: string } };
  };
  if (data.code !== 0) throw new Error(`Lark copy error ${data.code}: ${data.msg ?? 'unknown'}`);

  const fileToken = data.data?.file?.token;
  if (!fileToken) throw new Error('Lark response missing file token');

  return data.data?.file?.url ?? `https://bytedance.sg.larkoffice.com/docx/${fileToken}`;
}
