import { readDocContent } from './lark';

const MERGE_CALENDAR_URL = 'https://bytedance.larkoffice.com/wiki/BSAEww0sUiiK3MkL9kWcHFMFnte';

// Cache: version → code freeze date
let calendarCache: Map<string, Date> | null = null;
let calendarFetchedAt = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Parse the merge calendar wiki doc and extract version → code freeze date mappings.
 * Looks for rows with version numbers (e.g., "44.6", "44.7") and associated dates.
 */
async function fetchCalendar(): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();

  try {
    const content = await readDocContent(MERGE_CALENDAR_URL);
    // The calendar doc likely has a table with version numbers and dates
    // Look for patterns like "44.6" followed by dates in various formats
    const lines = content.split('\n');

    for (const line of lines) {
      // Match version numbers like 44.6, 44.7, 45.0
      const versionMatch = line.match(/\b(\d{2,3}\.\d{1,2})\b/);
      if (!versionMatch) continue;

      const version = versionMatch[1];

      // Look for dates in the same line: YYYY-MM-DD, MM/DD, or Month DD formats
      const datePatterns = [
        /(\d{4}-\d{2}-\d{2})/,                    // 2026-04-15
        /(\d{1,2}\/\d{1,2}\/\d{4})/,              // 4/15/2026
        /(\d{1,2}\/\d{1,2})/,                     // 4/15
        /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}/i,  // April 15
      ];

      for (const pattern of datePatterns) {
        const dateMatch = line.match(pattern);
        if (dateMatch) {
          const parsed = parseDate(dateMatch[0]);
          if (parsed) {
            // If the line contains "code freeze" or "freeze" or "CF", this is likely the freeze date
            if (/freeze|CF|code\s*freeze/i.test(line)) {
              map.set(version, parsed);
            } else if (!map.has(version)) {
              // Use the first date found as a fallback
              map.set(version, parsed);
            }
          }
          break;
        }
      }
    }
  } catch (e) {
    console.warn('[merge-calendar] failed to fetch/parse calendar:', e);
  }

  return map;
}

function parseDate(dateStr: string): Date | null {
  // Try ISO format
  const iso = Date.parse(dateStr);
  if (!isNaN(iso)) return new Date(iso);

  // Try MM/DD/YYYY
  const slashFull = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashFull) return new Date(Number(slashFull[3]), Number(slashFull[1]) - 1, Number(slashFull[2]));

  // Try MM/DD (assume current year)
  const slashShort = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashShort) return new Date(new Date().getFullYear(), Number(slashShort[1]) - 1, Number(slashShort[2]));

  // Try Month DD
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const monthMatch = dateStr.match(/^(\w{3})\w*\s+(\d{1,2})$/i);
  if (monthMatch) {
    const m = months[monthMatch[1].toLowerCase()];
    if (m !== undefined) return new Date(new Date().getFullYear(), m, Number(monthMatch[2]));
  }

  return null;
}

/**
 * Get the code freeze date for a given version (e.g., "44.6").
 * Caches the calendar for 24 hours.
 */
export async function getCodeFreezeDate(version: string): Promise<Date | null> {
  if (!calendarCache || Date.now() - calendarFetchedAt > CACHE_TTL) {
    calendarCache = await fetchCalendar();
    calendarFetchedAt = Date.now();
  }

  return calendarCache.get(version) ?? null;
}
