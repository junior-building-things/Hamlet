/** Lego avatar map — keyed by email prefix (filename without .png). */
const LEGO_AVATARS: Record<string, string> = {
  'thomas.oefverstroem': '/avatars/thomas.oefverstroem.png',
  'austin.lee':          '/avatars/austin.lee.png',
  'kyle.chan':            '/avatars/kyle.chan.png',
  'sheng.xuan':          '/avatars/sheng.xuan.png',
  'tianyang.ni':          '/avatars/tianyang.ni.png',
  'lionel.lew':           '/avatars/lionel.lew.png',
  'tao.zhu':              '/avatars/tao.zhu.png',
  'xiaobo.tian':          '/avatars/xiaobo.tian.png',
  'renshengnan.1208':     '/avatars/renshengnan.1208.png',
  'shashank.singh':       '/avatars/shashank.singh.png',
  'shenfangyuan':         '/avatars/shenfangyuan.png',
};

const FALLBACKS = ['/avatars/fallback1.png', '/avatars/fallback2.png'];

/** Get a deterministic fallback avatar based on the name string. */
function fallbackAvatar(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return FALLBACKS[Math.abs(hash) % FALLBACKS.length];
}

/** Resolve a display name to a lego avatar URL. */
export function getLegoAvatar(name: string, email?: string): string {
  // Try email prefix first
  if (email) {
    const key = email.split('@')[0];
    if (LEGO_AVATARS[key]) return LEGO_AVATARS[key];
  }
  // Try matching by name parts in the email keys
  const lower = name.toLowerCase();
  for (const [key, url] of Object.entries(LEGO_AVATARS)) {
    const parts = key.split('.');
    if (parts.every(p => lower.includes(p))) return url;
  }
  return fallbackAvatar(name);
}

/** Shared avatar URL map — keyed by display name. Populated with lego avatars. */
export const AV: Record<string, string> = {
  'Thomas':        LEGO_AVATARS['thomas.oefverstroem'],
  'Austin Lee':    LEGO_AVATARS['austin.lee'],
  'Kyle Chan':     LEGO_AVATARS['kyle.chan'],
  'Xuan Sheng':    LEGO_AVATARS['sheng.xuan'],
  '盛煊':          LEGO_AVATARS['sheng.xuan'],
  'Tianyang Ni':   LEGO_AVATARS['tianyang.ni'],
  '倪天洋':        LEGO_AVATARS['tianyang.ni'],
  'Rishou Bao':    FALLBACKS[0],
  '包日守':        FALLBACKS[0],
  'Kim Li':        FALLBACKS[1],
  'Lionel Lew':    LEGO_AVATARS['lionel.lew'],
  'Edward Lin':    FALLBACKS[0],
  'Tao Zhu':       LEGO_AVATARS['tao.zhu'],
  'Hazel Li':      FALLBACKS[1],
  'Xiaobo Tian':   LEGO_AVATARS['xiaobo.tian'],
  'Spring Ren':    LEGO_AVATARS['renshengnan.1208'],
  '任胜男':        LEGO_AVATARS['renshengnan.1208'],
  'Yunyi Yang':    FALLBACKS[0],
  'Shashank Singh': LEGO_AVATARS['shashank.singh'],
  'Fangyuan Shen': LEGO_AVATARS['shenfangyuan'],
  '沈方元':        LEGO_AVATARS['shenfangyuan'],
};
