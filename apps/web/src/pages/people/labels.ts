import type { PaymentMethod } from '@edustrux/shared';
import { t } from '../../i18n';

/** "1 student", "2 guardians": a whole phrase per number, never joined from fragments. */
export function countLabel(kind: 'students' | 'guardians', n: number) {
  if (kind === 'students')
    return n === 1 ? t('people.count.student') : t('people.count.students', { n });
  return n === 1 ? t('people.count.guardian') : t('people.count.guardians', { n });
}

export function methodLabel(method: PaymentMethod) {
  return t(`people.method.${method}`);
}
