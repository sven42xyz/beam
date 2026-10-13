/** Report categories. `csam` blocks the room immediately, before anyone has looked at it. */
export const REPORT_CATEGORIES = ['csam', 'violence', 'copyright', 'malware', 'personal', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_DESCRIPTION_MAX = 2000;
export const REPORT_CONTACT_MAX = 200;

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value);
}
