import { describe, expect, it } from 'vitest';
import { call, newOrg, newUser } from './helpers';

// The budget for an endpoint is about 3 database stages: sign-in, one read stage, one write
// (D-102). A read has no write, so it gets 2. Each setup endpoint is called once here, on its
// heaviest path: every optional check switched on. `stages` is held to the budget. `trips` is
// held to what the request made when TUI-98 was built, so a change that adds a call fails here.

type Res = Awaited<ReturnType<typeof call>>;
type Row = { id: string; updatedAt: string };

const READ = 2;
const WRITE = 3;

/** An owner with a fresh org, and `api` bound to that org. */
async function setup() {
  const owner = await newUser('owner');
  const org = await newOrg(owner.token);
  const api = (method: string, path: string, body?: unknown) =>
    call(method, `/api/v1/orgs/${org.id}${path}`, { token: owner.token, body });
  const make = async (path: string, body: unknown) => {
    const res = await api('POST', path, body);
    if (res.status !== 201) throw new Error(`POST ${path} failed: ${JSON.stringify(res.body)}`);
    return res.body as Row;
  };
  return { org, api, make };
}

/** Holds one request to its budget. The messages name the request, so a failure says which. */
function within(res: Res, request: string, status: number, max: { stages: number; trips: number }) {
  expect(res.status, request).toBe(status);
  expect(res.db.stages, `${request}: stages`).toBeLessThanOrEqual(max.stages);
  expect(res.db.trips, `${request}: trips`).toBeLessThanOrEqual(max.trips);
}

describe('setup endpoints stay within the database budget', () => {
  it('the org, branches and rooms', async () => {
    const { org, api } = await setup();
    const main = (await api('GET', '/branches')).body.data[0] as Row;

    within(await api('GET', ''), 'GET /orgs/{id}', 200, { stages: READ, trips: 1 });
    // Turning single-tutor mode on counts the branches, and a new slug is checked for a clash.
    const changeOrg = await api('PATCH', '', {
      updatedAt: org.updatedAt,
      singleTutorMode: true,
      slug: `${org.slug}-2`,
    });
    within(changeOrg, 'PATCH /orgs/{id}', 200, { stages: WRITE, trips: 4 });
    await api('PATCH', '', { updatedAt: changeOrg.body.updatedAt, singleTutorMode: false });

    const addBranch = await api('POST', '/branches', { name: 'Albany', address: '12 Main Road' });
    within(addBranch, 'POST /branches', 201, { stages: WRITE, trips: 3 });
    const albany = addBranch.body as Row;
    within(await api('GET', '/branches'), 'GET /branches', 200, { stages: READ, trips: 2 });
    const changeBranch = await api('PATCH', `/branches/${albany.id}`, {
      updatedAt: albany.updatedAt,
      name: 'Albany Village',
      address: null,
    });
    within(changeBranch, 'PATCH /branches/{id}', 200, { stages: WRITE, trips: 4 });

    const addRoom = await api('POST', `/branches/${main.id}/rooms`, {
      name: 'Room 1',
      capacity: 12,
    });
    within(addRoom, 'POST /branches/{id}/rooms', 201, { stages: WRITE, trips: 4 });
    const room = addRoom.body as Row;
    const rooms = await api('GET', `/branches/${main.id}/rooms`);
    within(rooms, 'GET /branches/{id}/rooms', 200, { stages: READ, trips: 3 });
    const changeRoom = await api('PATCH', `/rooms/${room.id}`, {
      updatedAt: room.updatedAt,
      name: 'Room One',
      capacity: 10,
    });
    within(changeRoom, 'PATCH /rooms/{id}', 200, { stages: WRITE, trips: 4 });
    const dropRoom = await api('DELETE', `/rooms/${room.id}`);
    within(dropRoom, 'DELETE /rooms/{id}', 204, { stages: WRITE, trips: 4 });

    // Deleting a branch reads it and runs six "is it in use" counts before the write.
    const dropBranch = await api('DELETE', `/branches/${albany.id}`);
    within(dropBranch, 'DELETE /branches/{id}', 204, { stages: WRITE, trips: 9 });
  });

  it('academic years, terms and holidays', async () => {
    const { api, make } = await setup();
    const main = (await api('GET', '/branches')).body.data[0] as Row;
    await make('/academic-years', { name: '2026', startDate: '2026-01-26', endDate: '2026-12-18' });

    const addYear = await api('POST', '/academic-years', {
      name: '2027',
      startDate: '2027-01-25',
      endDate: '2027-12-17',
    });
    within(addYear, 'POST /academic-years', 201, { stages: WRITE, trips: 4 });
    const year = addYear.body as Row;
    const years = await api('GET', '/academic-years');
    within(years, 'GET /academic-years', 200, { stages: READ, trips: 2 });

    await make('/terms', {
      academicYearId: year.id,
      name: 'Term 1',
      startDate: '2027-01-25',
      endDate: '2027-04-09',
    });
    const addTerm = await api('POST', '/terms', {
      academicYearId: year.id,
      name: 'Term 2',
      startDate: '2027-04-26',
      endDate: '2027-07-02',
    });
    within(addTerm, 'POST /terms', 201, { stages: WRITE, trips: 5 });
    const term = addTerm.body as Row;
    const terms = await api('GET', `/terms?academicYearId=${year.id}`);
    within(terms, 'GET /terms', 200, { stages: READ, trips: 3 });

    // One new date and a new name: the other date is the stored one, the year must still hold
    // its terms and miss the other year, and the name must be free.
    const changeYear = await api('PATCH', `/academic-years/${year.id}`, {
      updatedAt: year.updatedAt,
      name: 'Year 2027',
      endDate: '2027-12-20',
    });
    within(changeYear, 'PATCH /academic-years/{id}', 200, { stages: WRITE, trips: 6 });
    // The same for a term: it must stay inside its year, miss Term 1, and the name must be free.
    const changeTerm = await api('PATCH', `/terms/${term.id}`, {
      updatedAt: term.updatedAt,
      name: 'Winter term',
      endDate: '2027-07-09',
    });
    within(changeTerm, 'PATCH /terms/{id}', 200, { stages: WRITE, trips: 5 });
    const dropTerm = await api('DELETE', `/terms/${term.id}`);
    within(dropTerm, 'DELETE /terms/{id}', 204, { stages: WRITE, trips: 4 });

    // A holiday for one branch: the branch is looked up, and the sessions it closes are counted.
    const addHoliday = await api('POST', '/holidays', {
      name: 'Matariki',
      startDate: '2027-06-25',
      endDate: '2027-06-25',
      branchId: main.id,
    });
    within(addHoliday, 'POST /holidays', 201, { stages: WRITE, trips: 4 });
    const holidays = await api(
      'GET',
      `/holidays?branchId=${main.id}&from=2027-01-01&to=2027-12-31`,
    );
    within(holidays, 'GET /holidays', 200, { stages: READ, trips: 3 });
    const dropHoliday = await api('DELETE', `/holidays/${addHoliday.body.id}`);
    within(dropHoliday, 'DELETE /holidays/{id}', 204, { stages: WRITE, trips: 3 });
  });

  it('grade levels, subjects and courses', async () => {
    const { api, make } = await setup();

    const addGrade = await api('POST', '/grade-levels', { name: 'Year 10' });
    within(addGrade, 'POST /grade-levels', 201, { stages: WRITE, trips: 4 });
    const grade = addGrade.body as Row;
    const spareGrade = await make('/grade-levels', { name: 'Year 11' });
    const grades = await api('GET', '/grade-levels');
    within(grades, 'GET /grade-levels', 200, { stages: READ, trips: 2 });
    const changeGrade = await api('PATCH', `/grade-levels/${grade.id}`, {
      updatedAt: grade.updatedAt,
      name: 'Year Ten',
    });
    within(changeGrade, 'PATCH /grade-levels/{id}', 200, { stages: WRITE, trips: 4 });
    const reorder = await api('PUT', '/grade-levels/order', { ids: [spareGrade.id, grade.id] });
    within(reorder, 'PUT /grade-levels/order', 200, { stages: WRITE, trips: 3 });

    const addSubject = await api('POST', '/subjects', { name: 'Mathematics' });
    within(addSubject, 'POST /subjects', 201, { stages: WRITE, trips: 3 });
    const subject = addSubject.body as Row;
    const spareSubject = await make('/subjects', { name: 'Science' });
    within(await api('GET', '/subjects'), 'GET /subjects', 200, { stages: READ, trips: 2 });
    const changeSubject = await api('PATCH', `/subjects/${subject.id}`, {
      updatedAt: subject.updatedAt,
      name: 'Maths',
    });
    within(changeSubject, 'PATCH /subjects/{id}', 200, { stages: WRITE, trips: 4 });

    // Every field set: the subject and grade level are looked up, and the combination checked.
    const addCourse = await api('POST', '/courses', {
      subjectId: subject.id,
      gradeLevelId: grade.id,
      curriculum: 'Cambridge',
      teachingMedium: 'English',
      defaultPrice: { amount: 4500, currency: 'NZD' },
      durationMinutes: 60,
    });
    within(addCourse, 'POST /courses', 201, { stages: WRITE, trips: 5 });
    const course = addCourse.body as Row;
    const courses = await api('GET', `/courses?subjectId=${subject.id}&gradeLevelId=${grade.id}`);
    within(courses, 'GET /courses', 200, { stages: READ, trips: 4 });
    // A new curriculum with the stored medium: the combination is checked again.
    const changeCourse = await api('PATCH', `/courses/${course.id}`, {
      updatedAt: course.updatedAt,
      curriculum: 'NCEA',
      defaultPrice: { amount: 5000, currency: 'NZD' },
      durationMinutes: 90,
    });
    within(changeCourse, 'PATCH /courses/{id}', 200, { stages: WRITE, trips: 4 });
    // Deleting a course counts its classes and its price rules.
    const dropCourse = await api('DELETE', `/courses/${course.id}`);
    within(dropCourse, 'DELETE /courses/{id}', 204, { stages: WRITE, trips: 5 });

    // A grade level counts its courses and its students' grade records; a subject its courses.
    const dropGrade = await api('DELETE', `/grade-levels/${spareGrade.id}`);
    within(dropGrade, 'DELETE /grade-levels/{id}', 204, { stages: WRITE, trips: 5 });
    const dropSubject = await api('DELETE', `/subjects/${spareSubject.id}`);
    within(dropSubject, 'DELETE /subjects/{id}', 204, { stages: WRITE, trips: 4 });
  });
});
