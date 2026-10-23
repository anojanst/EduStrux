import type { Session } from '@edustrux/shared';
import { Check } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { buttonClass } from '../../components/ui/Button';
import { t } from '../../i18n';
import { markedCount, useClassPaths } from '../../lib/classes';
import { useFormat } from '../../lib/format';
import { useOrg } from '../../lib/org';
import { can } from '../../lib/roles';

/** "8 present · 1 absent": the counts that aren't 0, in the order a register reads. */
export function marksLabel(session: Session) {
  const a = session.attendance;
  if (!a) return '';
  return (['present', 'late', 'absent', 'excused'] as const)
    .filter((status) => a[status] > 0)
    .map((status) => t(`classes.marks.${status}`, { n: a[status] }))
    .join(' · ');
}

/**
 * What a lesson row shows about its attendance (ui-design.md §6 Lesson row): the result once
 * someone is marked, "Mark attendance" from the lesson's day on for those who can, and nothing
 * for a lesson still to come.
 */
export function LessonResult({ session }: { session: Session }) {
  const { membership } = useOrg();
  const format = useFormat();
  const paths = useClassPaths();
  if (!session.attendance) return null;
  if (markedCount(session) > 0) {
    return (
      <Badge tone="success">
        <Check className="size-3.5" aria-hidden />
        {marksLabel(session)}
      </Badge>
    );
  }
  if (session.date > format.today) return null;
  if (can(membership.role, 'attendance:write')) {
    return (
      <Link to={paths.lesson(session.id)} className={buttonClass('secondary', 'sm')}>
        {t('classes.markAttendance')}
      </Link>
    );
  }
  return <Badge>{t('classes.notMarked')}</Badge>;
}
