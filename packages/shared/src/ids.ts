// Prefixed, sortable IDs: `<prefix>_<ulid>` in lowercase, e.g. `org_01j9z3k6m2...`.
// ULIDs start with a 48-bit timestamp, so IDs sort by creation time.

export const ID_PREFIXES = {
  user: 'usr',
  org: 'org',
  membership: 'mem',
  invitation: 'ivt',
  branch: 'brn',
  room: 'rm',
  gradeLevel: 'grd',
  subject: 'sbj',
  academicYear: 'acy',
  term: 'trm',
  holiday: 'hol',
  taxRate: 'txr',
  student: 'stu',
  family: 'fam',
  guardian: 'gdn',
  studentGrade: 'sgr',
  course: 'crs',
  class: 'cls',
  classSchedule: 'csl',
  session: 'ses',
  enrolment: 'enr',
  attendance: 'att',
  absenceNotice: 'abn',
  makeupPolicy: 'mkp',
  makeupCredit: 'mkc',
  makeupBooking: 'mkb',
  lessonHomework: 'lhw',
  lessonNote: 'lnt',
  priceRule: 'prr',
  invoice: 'inv',
  invoiceLine: 'inl',
  payment: 'pay',
  paymentAllocation: 'pal',
  message: 'msg',
  messageRecipient: 'mrc',
  messageTemplate: 'mtp',
  notificationSettings: 'nts',
  webhookEvent: 'whe',
  job: 'job',
  audit: 'aud',
  idempotency: 'idem',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = '';
  for (const b of bytes) random += ALPHABET[b % 32];
  return time + random;
}

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${ulid()}`;
}

/**
 * The code a family quotes on a bank transfer, so a payment can be matched to them: the last 8
 * characters of the family's id, which are random, in capitals. Unique within an org.
 */
export function bankReferenceFor(familyId: string): string {
  return familyId.slice(-8).toUpperCase();
}
