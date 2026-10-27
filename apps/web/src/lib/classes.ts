import type {
  Class,
  Course,
  Room,
  ScheduleSlot,
  Session,
  Subject,
  Teacher,
  TeacherList,
  Term,
} from '@edustrux/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, weekday } from '@edustrux/shared/dates';
import { t } from '../i18n';
import { api } from './api';
import { orgApiPath, useOrg } from './org';
import { namesOf, useGradeLevels, type Page } from './people';
import { can } from './roles';
import { orgPath } from './session';

/** Lists read often and changed rarely: the org's terms, subjects and courses. */
function useOrgList<T>(name: string, path: string, enabled = true) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: [name, membership.org.id],
    queryFn: ({ signal }) => api<Page<T>>('GET', orgApiPath(membership, path), { signal }),
    enabled,
    staleTime: 60_000,
  });
}

export const useTerms = () => useOrgList<Term>('terms', '/terms?limit=200');
export const useSubjects = () => useOrgList<Subject>('subjects', '/subjects?limit=200');
export const useCourses = () => useOrgList<Course>('courses', '/courses?limit=200');

/** Every class the caller reaches, to count those at a branch, in a room or in a term. */
export function useAllClasses() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['classes', membership.org.id, { all: true }],
    queryFn: ({ signal }) =>
      api<Page<Class>>('GET', orgApiPath(membership, '/classes?limit=200'), { signal }),
    staleTime: 60_000,
  });
}

/** A branch's rooms; off until a branch is chosen. */
export function useRooms(branchId: string | null | undefined) {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['rooms', membership.org.id, branchId],
    queryFn: ({ signal }) =>
      api<Page<Room>>('GET', orgApiPath(membership, `/branches/${branchId}/rooms?limit=200`), {
        signal,
      }),
    enabled: Boolean(branchId),
    staleTime: 60_000,
  });
}

/** Who a class can be given to (`GET /teachers`): only for roles that change classes. */
export function useTeachers() {
  const { membership } = useOrg();
  return useQuery({
    queryKey: ['teachers', membership.org.id],
    queryFn: ({ signal }) =>
      api<TeacherList>('GET', orgApiPath(membership, '/teachers'), { signal }),
    enabled: can(membership.role, 'classes:write'),
    staleTime: 60_000,
  });
}

export type { Teacher };

/** "Year 9 Mathematics": a course's grade and subject, once both lists have loaded. */
export function useCourseLabel() {
  const courses = useCourses();
  const subject = namesOf(useSubjects().data?.data);
  const grade = namesOf(useGradeLevels().data?.data);
  const byId = new Map(courses.data?.data.map((c) => [c.id, c]));
  return (courseId: string) => {
    const course = byId.get(courseId);
    if (!course) return '';
    return t('classes.course', {
      grade: grade(course.gradeLevelId),
      subject: subject(course.subjectId),
    }).trim();
  };
}

/** Where the classes pages live in this org. */
export function useClassPaths() {
  const { membership } = useOrg();
  const base = orgPath(membership.org.slug);
  return {
    list: `${base}/classes`,
    class: (id: string, tab?: string) => `${base}/classes/${id}${tab ? `?tab=${tab}` : ''}`,
    lesson: (id: string) => `${base}/lessons/${id}`,
  };
}

export const classKey = (orgId: string, classId: string) => ['class', orgId, classId];

/** After a change to a class, its enrolments or its lessons: everything that shows them. */
export function useRefreshClasses() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const orgId = membership.org.id;
  return () =>
    Promise.all(
      [
        ['classes', orgId],
        ['class', orgId],
        ['sessions', orgId],
        ['session', orgId],
        ['enrolments', orgId],
        ['attendance', orgId],
        ['clashes', orgId],
        ['students', orgId],
        ['student', orgId],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

/** After a change to a subject, grade level or course: the lists that show them. */
export function useRefreshCurriculum() {
  const { membership } = useOrg();
  const queryClient = useQueryClient();
  const orgId = membership.org.id;
  return () =>
    Promise.all(
      ['subjects', 'grade-levels', 'courses'].map((name) =>
        queryClient.invalidateQueries({ queryKey: [name, orgId] }),
      ),
    );
}

/** Where the courses settings live in this org, on a tab. */
export function useCoursesPath() {
  const { membership } = useOrg();
  return (tab?: 'subjects' | 'grades') =>
    `${orgPath(membership.org.slug)}/settings/courses${tab ? `?tab=${tab}` : ''}`;
}

/** The term (or academic year) that is on today, else the next one to start, else the last one. */
export function currentTerm<T extends { startDate: string; endDate: string }>(
  terms: T[],
  today: string,
): T | undefined {
  const sorted = [...terms].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return (
    sorted.find((term) => term.startDate <= today && term.endDate >= today) ??
    sorted.find((term) => term.startDate > today) ??
    sorted.at(-1)
  );
}

/** The dates a class runs: its own, else its term's. Open-ended classes have no end. */
export function classRange(klass: Class, term: Term | undefined) {
  return {
    start: klass.startDate ?? term?.startDate ?? null,
    end: klass.endDate ?? term?.endDate ?? null,
  };
}

/** The Monday of the week a date is in. */
export function weekOf(date: string) {
  return addDays(date, 1 - weekday(date));
}

/** Slots in weekday, then start-time order. */
export function sortSlots(slots: ScheduleSlot[]) {
  return [...slots].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
}

/** Students marked at a lesson, all statuses together. */
export function markedCount(session: Session) {
  const a = session.attendance;
  return a ? a.present + a.late + a.absent + a.excused : 0;
}
