/**
 * Cron expression encode/decode for the (time-of-day, frequency)
 * dropdowns shown in the Cron Jobs tab.
 *
 * Supports the common patterns we use:
 *   "Daily"     → `* * *`        (every day-of-week)
 *   "Weekdays"  → `* * 1-5`
 *   "Weekends"  → `* * 0,6`
 *   "Mondays"   → `* * 1`        (and Tue–Sun similarly)
 *
 * Times are expressed in the job's local timezone (we treat all as
 * Asia/Singapore for the current jobs, hence the "SGT" suffix).
 */

export const TIME_OPTIONS = [
  '12am SGT', '1am SGT', '2am SGT', '3am SGT', '4am SGT', '5am SGT',
  '6am SGT', '7am SGT', '8am SGT', '9am SGT', '10am SGT', '11am SGT',
  '12pm SGT', '1pm SGT', '2pm SGT', '3pm SGT', '4pm SGT', '5pm SGT',
  '6pm SGT', '7pm SGT', '8pm SGT', '9pm SGT', '10pm SGT', '11pm SGT',
] as const;

export const FREQUENCY_OPTIONS = [
  'Daily', 'Weekdays', 'Weekends',
  'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays',
  'Saturdays', 'Sundays',
] as const;

export type TimeOption = typeof TIME_OPTIONS[number];
export type FrequencyOption = typeof FREQUENCY_OPTIONS[number];

export function timeToHour(t: string): number {
  const m = t.match(/^(\d+)(am|pm)/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const ap = m[2].toLowerCase();
  if (ap === 'pm' && h !== 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h;
}

export function hourToTime(h: number): string {
  if (h === 0) return '12am SGT';
  if (h === 12) return '12pm SGT';
  if (h < 12) return `${h}am SGT`;
  return `${h - 12}pm SGT`;
}

const FREQ_TO_DOW: Record<string, string> = {
  'Daily':      '*',
  'Weekdays':   '1-5',
  'Weekends':   '0,6',
  'Mondays':    '1',
  'Tuesdays':   '2',
  'Wednesdays': '3',
  'Thursdays':  '4',
  'Fridays':    '5',
  'Saturdays':  '6',
  'Sundays':    '0',
};

export function frequencyToDow(f: string): string {
  return FREQ_TO_DOW[f] ?? '*';
}

export function dowToFrequency(d: string): string {
  // Normalise common equivalents.
  const norm = d.trim();
  if (norm === '*') return 'Daily';
  if (norm === '1-5' || norm === 'MON-FRI' || norm === 'mon-fri') return 'Weekdays';
  if (norm === '0,6' || norm === '6,0' || norm === 'SAT,SUN' || norm === 'sat,sun') return 'Weekends';
  if (norm === '1' || norm === 'MON' || norm === 'mon') return 'Mondays';
  if (norm === '2' || norm === 'TUE' || norm === 'tue') return 'Tuesdays';
  if (norm === '3' || norm === 'WED' || norm === 'wed') return 'Wednesdays';
  if (norm === '4' || norm === 'THU' || norm === 'thu') return 'Thursdays';
  if (norm === '5' || norm === 'FRI' || norm === 'fri') return 'Fridays';
  if (norm === '6' || norm === 'SAT' || norm === 'sat') return 'Saturdays';
  if (norm === '0' || norm === '7' || norm === 'SUN' || norm === 'sun') return 'Sundays';
  return norm;
}

export function buildCronExpression(time: string, frequency: string): string {
  return `0 ${timeToHour(time)} * * ${frequencyToDow(frequency)}`;
}

export interface ParsedCron {
  time: string;
  frequency: string;
}

export function parseCronExpression(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [, hour, , , dow] = parts;
  const h = parseInt(hour, 10);
  if (isNaN(h) || h < 0 || h > 23) return null;
  return { time: hourToTime(h), frequency: dowToFrequency(dow) };
}
