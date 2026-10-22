import { localNow, scopeFor, type Dashboard } from '@edustrux/shared';
import type { Access, OrgCtx } from '../../db/scope';
import * as attendance from '../attendance/service';
import * as billing from '../billing/service';
import * as classes from '../classes/service';
import * as enrolment from '../enrolment/service';
import * as orgs from '../orgs/service';
import * as people from '../people/service';

// Reports read what other modules give them, each as far as the caller reaches. The module owns
// no tables (TUI-62, TUI-63).

/**
 * The home dashboard: families, students and classes the caller reaches, today's lessons, the
 * last two weeks' lessons still unmarked, students away today, make-up credits waiting, and for
 * those who see money reports, what is owed. One stage: every read goes together.
 */
export async function dashboard(ctx: OrgCtx, access: Access): Promise<Dashboard> {
  const { timezone } = await orgs.getOrg(ctx);
  const today = localNow(timezone).date;
  // Money is for the roles with money reports: the owner and branch managers here. An
  // accountant has no dashboard (403), and front desk and teachers get none.
  const moneyScope = scopeFor(access.role, 'reports:money');
  const [families, students, lessons, marks, money] = await Promise.all([
    people.countFamiliesReached(ctx, access),
    enrolment.countStudentsEnrolled(ctx, access),
    classes.dashboardLessons(ctx, access, today),
    attendance.dashboardAttendance(ctx, access, classes.recentLessons(ctx, access, today), today),
    moneyScope ? billing.moneySummary(ctx, { ...access, scope: moneyScope }) : undefined,
  ]);
  const todays = lessons.lessons.filter((lesson) => lesson.date === today);
  const scheduled = lessons.lessons.filter((lesson) => lesson.status === 'scheduled');
  return {
    date: today,
    families,
    students,
    classes: lessons.classes,
    today: {
      lessons: todays.length,
      cancelled: todays.filter((lesson) => lesson.status === 'cancelled').length,
      marked: todays.filter((lesson) => marks.marked.has(lesson.id)).length,
      absenceNotices: marks.away,
    },
    unmarkedLessons: scheduled.filter((lesson) => !marks.marked.has(lesson.id)).length,
    makeupCreditsAvailable: marks.credits,
    ...(money ? { money } : {}),
  };
}

export const moneyReport = billing.moneyReport;
