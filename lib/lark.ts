const LARK_BASE_URL    = process.env.LARK_BASE_URL    ?? 'https://bytedance.sg.larkoffice.com';
const TEMPLATE_TOKEN   = 'Z5qldS3kEoC1WAxPyMucR9RpneX';

interface CopyResponse {
  code: number;
  msg?: string;
  data?: { file?: { token?: string; url?: string; name?: string } };
}

/**
 * Copies the PRD template document and names it after the feature.
 * Requires LARK_ACCESS_TOKEN env var.
 * Returns the URL of the new document.
 */
export async function copyPrdTemplate(featureName: string): Promise<string> {
  const token = process.env.LARK_ACCESS_TOKEN;
  if (!token) throw new Error('LARK_ACCESS_TOKEN is not configured in .env.local');

  const res = await fetch(
    `${LARK_BASE_URL}/open-apis/drive/v1/files/${TEMPLATE_TOKEN}/copy`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: featureName, type: 'docx' }),
    },
  );

  const data = await res.json() as CopyResponse;
  if (data.code !== 0) throw new Error(`Lark API error ${data.code}: ${data.msg ?? 'unknown'}`);

  const fileToken = data.data?.file?.token;
  if (!fileToken) throw new Error('Lark response missing file token');

  return `${LARK_BASE_URL}/docx/${fileToken}`;
}
