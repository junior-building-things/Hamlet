const CLOUD_AUTH_URL = 'https://cloud.bytedance.net/auth/api/v1/jwt';
const BITS_BASE_URL = 'https://bits.bytedance.net';
const IOS_PROJECT_ID = '114467';

let cachedJwt = '';
let cachedJwtExp = 0;

async function getJwt(): Promise<string> {
  if (cachedJwt && Date.now() < cachedJwtExp) return cachedJwt;

  const secret = process.env.SERVICE_ACCOUNT_SECRET;
  if (!secret) throw new Error('SERVICE_ACCOUNT_SECRET not configured');

  const res = await fetch(CLOUD_AUTH_URL, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  const jwt = res.headers.get('x-jwt-token');
  if (!jwt) throw new Error('No JWT token in cloud auth response');

  cachedJwt = jwt;
  cachedJwtExp = Date.now() + 50 * 60 * 1000; // ~50 min (token lasts 1h)
  return jwt;
}

/**
 * Get the latest iOS package install URL for a given commit hash.
 * Returns the ttidevops install URL, or null if no package found.
 */
export async function getIosPackageUrl(commitHash: string): Promise<string | null> {
  // Skip if internal APIs not reachable (Cloud Run / Vercel can't reach bits.bytedance.net)
  if (!process.env.SERVICE_ACCOUNT_SECRET || process.env.K_SERVICE) return null;
  try {
    const jwt = await getJwt();
    const res = await fetch(
      `${BITS_BASE_URL}/api/mr_package/mr/groups?project_id=${IOS_PROJECT_ID}&commit_id=${commitHash}&limit=1`,
      { headers: { Authorization: `Bearer ${jwt}` } },
    );

    if (!res.ok) {
      console.warn('[bits] mr/groups failed:', res.status);
      return null;
    }

    const data = await res.json() as {
      code: number;
      data?: {
        groups?: Array<{
          packages?: Array<{ id: number; package_name: string; app_type: number; install_url: string }>;
        }>;
      };
    };

    if (data.code !== 200) {
      console.warn('[bits] mr/groups error:', data.code);
      return null;
    }

    for (const group of data.data?.groups ?? []) {
      for (const pkg of group.packages ?? []) {
        // Look for iOS packages (app_type=1) with MusicallyInhouse or TikTokInhouse
        if (pkg.app_type === 1 && /Inhouse/i.test(pkg.package_name)) {
          const installUrl = `https://ttidevops.cn.goofy.app/install.html?package_id=${pkg.id}`;
          console.log('[bits] found iOS package:', pkg.id, pkg.package_name);
          return installUrl;
        }
      }
    }

    console.log('[bits] no iOS package found for commit:', commitHash.slice(0, 8));
    return null;
  } catch (e) {
    console.warn('[bits] getIosPackageUrl failed:', e);
    return null;
  }
}
