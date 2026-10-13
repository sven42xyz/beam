/** Report categories, in the order they are offered. */
export const REPORT_CATEGORIES = [
  'csam',
  'sexual_violence',
  'violence',
  'copyright',
  'malware',
  'personal',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * Reports in these categories block the room immediately, before anyone has looked at it:
 * the harm of leaving such content up outweighs a wrongly blocked room, which can be unblocked.
 */
export const AUTO_BLOCK_CATEGORIES: readonly ReportCategory[] = ['csam', 'sexual_violence'];

export const REPORT_DESCRIPTION_MAX = 2000;
export const REPORT_CONTACT_MAX = 200;

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value);
}
