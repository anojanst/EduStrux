/**
 * Starting points for the setup wizard (TUI-64): a centre picks or edits them, nothing is saved
 * until it says so. By the org's country where the usual names differ.
 */

const numbered = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix} ${from + i}`);

export const GRADE_PRESETS = {
  year13: numbered('Year', 1, 13),
  year12: numbered('Year', 1, 12),
  gradeK12: ['Kindergarten', ...numbered('Grade', 1, 12)],
  grade12: numbered('Grade', 1, 12),
  grade13: numbered('Grade', 1, 13),
  class12: numbered('Class', 1, 12),
} as const;
export type GradePreset = keyof typeof GRADE_PRESETS;

const GRADES_BY_COUNTRY: Record<string, GradePreset> = {
  NZ: 'year13',
  GB: 'year13',
  IE: 'year12',
  AU: 'year12',
  US: 'gradeK12',
  CA: 'gradeK12',
  ZA: 'grade12',
  PH: 'grade12',
  KE: 'grade12',
  AE: 'grade12',
  LK: 'grade13',
  IN: 'class12',
  PK: 'class12',
  BD: 'class12',
};

/** The grade names a centre in this country most likely uses. */
export function gradePresetFor(country: string | null | undefined): GradePreset {
  return (country && GRADES_BY_COUNTRY[country]) || 'year13';
}

export const SUBJECTS = [
  'Mathematics',
  'English',
  'Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Accounting',
  'Economics',
  'Computer Science',
  'Music',
  'Art',
];

/** Picked to start with: what most tuition centres teach. */
export const STARTING_SUBJECTS = ['Mathematics', 'English', 'Science'];

const TAX_NAMES: Record<string, string> = {
  NZ: 'GST',
  AU: 'GST',
  SG: 'GST',
  IN: 'GST',
  CA: 'GST',
  MY: 'SST',
  US: 'Sales tax',
};

/** What tax is called there; VAT elsewhere. No rate is suggested: tuition is often exempt. */
export function taxNameFor(country: string | null | undefined): string {
  return (country && TAX_NAMES[country]) || 'VAT';
}
