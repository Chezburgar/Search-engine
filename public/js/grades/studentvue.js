// StudentVUE client for Montgomery County Public Schools (MCPS), ported from GradeFlow.
//
// StudentVUE speaks SOAP and doesn't allow calls from other websites, so requests go through
// a transport: on GitHub Pages, the CORS-enabled StudentVUE relay GradeFlow uses; on the
// Node server, Spark's own /api/studentvue endpoint. Both return { status, response: xml }.

import { parseXml, escapeXml, find, kid, kids, attr, text, path } from './xml.js';

export const MCPS = {
  name: 'Montgomery County Public Schools',
  short: 'MCPS',
  host: 'https://md-mcps-psv.edupoint.com',
};
export const RELAY = 'https://studentvuelib.up.railway.app';
export const ASMX = `${MCPS.host}/Service/PXPCommunication.asmx`;

// The only calls Spark Grades makes (the server endpoint allows just these).
export const METHODS = ['StudentInfo', 'Gradebook', 'Attendance', 'StudentClassList', 'StudentCalendar'];

export class StudentVueError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'StudentVueError';
    this.kind = kind;
  }
}

export function soapEnvelope({ username, password, method, paramStr }) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body>' +
    '<ProcessWebServiceRequestMultiWeb xmlns="http://edupoint.com/webservices/">' +
    `<userID>${escapeXml(username)}</userID>` +
    `<password>${escapeXml(password)}</password>` +
    '<skipLoginLog>1</skipLoginLog>' +
    '<parent>0</parent>' +
    '<webServiceHandleName>PXPWebServices</webServiceHandleName>' +
    `<methodName>${escapeXml(method)}</methodName>` +
    `<paramStr>${escapeXml(paramStr)}</paramStr>` +
    '</ProcessWebServiceRequestMultiWeb>' +
    '</soap:Body></soap:Envelope>'
  );
}

export const paramsFor = (method, { reportPeriod } = {}) =>
  method === 'Gradebook' && reportPeriod != null && Number.isInteger(Number(reportPeriod))
    ? `<Parms><ChildIntID>0</ChildIntID><ReportPeriod>${Number(reportPeriod)}</ReportPeriod></Parms>`
    : '<Parms><ChildIntID>0</ChildIntID></Parms>';

// Unwraps the SOAP response down to StudentVUE's own XML document.
export function unwrap(soapXml) {
  const result = find(parseXml(soapXml), 'ProcessWebServiceRequestMultiWebResult');
  if (!result) throw new StudentVueError('Unexpected response from MCPS StudentVUE.', 'parse');
  const inner = text(result);
  if (!inner.startsWith('<')) {
    throw new StudentVueError(inner || 'StudentVUE returned an empty response.', 'auth');
  }
  const doc = parseXml(inner);
  const err = find(doc, 'RT_ERROR');
  if (err) {
    const msg = attr(err, 'ERROR_MESSAGE') || 'StudentVUE reported an error.';
    const isAuth = /invalid user|password|login|credential/i.test(msg);
    throw new StudentVueError(isAuth ? 'Incorrect student ID or password.' : msg, isAuth ? 'auth' : 'svue');
  }
  return doc;
}

/* -------------------------------- transports ------------------------------ */

export const relayTransport =
  (relay = RELAY) =>
  async ({ username, password, method, paramStr, signal }) => {
    const res = await fetch(`${relay}/fulfillAxios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: ASMX,
        xml: soapEnvelope({ username, password, method, paramStr }),
        encrypted: false,
      }),
      signal,
    });
    if (!res.ok) throw new StudentVueError(`The StudentVUE relay answered ${res.status}.`, 'proxy');
    return res.json();
  };

export const serverTransport =
  (endpoint = 'api/studentvue') =>
  async ({ username, password, method, paramStr, signal }) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, method, paramStr }),
      signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new StudentVueError(data?.message || `Spark's StudentVUE link answered ${res.status}.`, 'proxy');
    return data;
  };

export function createStudentVue({ transport = relayTransport(), timeout = 30000 } = {}) {
  async function call(creds, method, opts = {}) {
    if (!METHODS.includes(method)) throw new StudentVueError(`Unsupported call ${method}.`, 'svue');
    let json;
    try {
      json = await transport({
        username: creds.username,
        password: creds.password,
        method,
        paramStr: paramsFor(method, opts),
        signal: opts.signal
          ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      });
    } catch (err) {
      if (err?.name === 'AbortError' && opts.signal?.aborted) throw err;
      if (err instanceof StudentVueError) throw err;
      throw new StudentVueError(
        err?.name === 'TimeoutError'
          ? 'MCPS StudentVUE took too long to answer. Try again in a moment.'
          : "Couldn't reach MCPS StudentVUE. Check your connection and try again.",
        'network'
      );
    }
    if (!json?.status || !json.response) {
      throw new StudentVueError(json?.message || 'MCPS StudentVUE returned an error.', 'proxy');
    }
    return unwrap(json.response);
  }

  return {
    studentInfo: (c, o) => call(c, 'StudentInfo', o).then(parseStudentInfo),
    gradebook: (c, o = {}) => call(c, 'Gradebook', o).then(parseGradebook),
    attendance: (c, o) => call(c, 'Attendance', o).then(parseAttendance),
    schedule: (c, o) => call(c, 'StudentClassList', o).then(parseSchedule),
    calendar: (c, o) => call(c, 'StudentCalendar', o).then(parseCalendar),
  };
}

/* --------------------------------- parsers -------------------------------- */

const num = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[%,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const rootOf = (doc, name) => find(doc, name) || doc.children[0] || doc;

export function parseStudentInfo(doc) {
  const si = rootOf(doc, 'StudentInfo');
  const t = (name) => text(kid(si, name)) || attr(si, name);
  return {
    name: t('FormattedName'),
    nickname: t('NickName'),
    studentId: t('PermID'),
    grade: t('Grade'),
    school: t('CurrentSchool'),
    email: t('EMail'),
    photo: t('Photo'),
    counselor: t('CounselorName'),
  };
}

export function parseGradebook(doc) {
  const gb = rootOf(doc, 'Gradebook');
  const reportPeriods = kids(path(gb, 'ReportingPeriods'), 'ReportPeriod').map((r) => ({
    index: Number(attr(r, 'Index')) || 0,
    name: attr(r, 'GradePeriod'),
    startDate: attr(r, 'StartDate'),
    endDate: attr(r, 'EndDate'),
  }));
  const current = kid(gb, 'ReportingPeriod');
  const currentName = attr(current, 'GradePeriod');
  const reportPeriod = {
    index: reportPeriods.find((r) => r.name === currentName)?.index ?? reportPeriods[0]?.index ?? 0,
    name: currentName || reportPeriods[0]?.name || 'Current',
    startDate: attr(current, 'StartDate'),
    endDate: attr(current, 'EndDate'),
  };
  const courses = kids(path(gb, 'Courses'), 'Course').map(parseCourse);
  return { reportPeriod, reportPeriods, courses };
}

function parseCourse(c, i) {
  const mark = kids(path(c, 'Marks'), 'Mark')[0] || null;
  const categories = kids(path(mark, 'GradeCalculationSummary'), 'AssignmentGradeCalc')
    .map((g) => ({
      type: attr(g, 'Type'),
      weight: num(attr(g, 'Weight')) != null ? num(attr(g, 'Weight')) / 100 : null,
      points: num(attr(g, 'Points')),
      pointsPossible: num(attr(g, 'PointsPossible')),
      percent: num(attr(g, 'WeightedPct')) ?? num(attr(g, 'CalculatedMark')),
      mark: attr(g, 'CalculatedMark'),
    }))
    .filter((g) => g.type && g.type.toLowerCase() !== 'total');
  return {
    id: `${attr(c, 'Period') || i}-${i}`,
    period: attr(c, 'Period'),
    title: attr(c, 'Title'),
    room: attr(c, 'Room'),
    teacher: attr(c, 'Staff'),
    teacherEmail: attr(c, 'StaffEMail'),
    mark: attr(mark, 'CalculatedScoreString'),
    scoreRaw: num(attr(mark, 'CalculatedScoreRaw')),
    categories,
    assignments: kids(path(mark, 'Assignments'), 'Assignment').map(parseAssignment),
  };
}

export function parseAssignment(a, i = 0) {
  const points = attr(a, 'Points');
  let earned = null;
  let possible = null;
  const m = points.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (m) {
    earned = parseFloat(m[1]);
    possible = parseFloat(m[2]);
  } else {
    possible = num(points.replace(/points?\s*possible/i, ''));
  }
  const scoreString = attr(a, 'Score') || attr(a, 'ScoreCalValue');
  const graded = earned != null && !/not graded/i.test(scoreString);
  return {
    id: attr(a, 'GradebookID') || `${attr(a, 'Measure')}-${i}`,
    name: attr(a, 'Measure'),
    type: attr(a, 'Type'),
    date: attr(a, 'Date'),
    dueDate: attr(a, 'DueDate') || attr(a, 'Date'),
    scoreString,
    points,
    pointsEarned: graded ? earned : null,
    pointsPossible: possible,
    percent: graded && possible ? (earned / possible) * 100 : null,
    notes: attr(a, 'Notes'),
    graded,
  };
}

export function parseAttendance(doc) {
  const at = rootOf(doc, 'Attendance');
  const events = kids(path(at, 'Absences'), 'Absence').map((ab) => ({
    date: attr(ab, 'AbsenceDate'),
    reason: attr(ab, 'Reason'),
    note: attr(ab, 'Note'),
    periods: kids(path(ab, 'Periods'), 'Period')
      .map((p) => ({
        period: attr(p, 'Number'),
        name: attr(p, 'Name'),
        reason: attr(p, 'Reason'),
        course: attr(p, 'Course'),
        staff: attr(p, 'Staff'),
      }))
      .filter((p) => p.name || p.course),
  }));
  const totals = { excused: 0, unexcused: 0, tardy: 0, activity: 0 };
  for (const e of events) {
    const r = `${e.reason} ${e.periods.map((p) => p.name).join(' ')}`.toLowerCase();
    if (r.includes('tardy')) totals.tardy++;
    else if (r.includes('unexcused')) totals.unexcused++;
    else if (r.includes('activit')) totals.activity++;
    else totals.excused++;
  }
  return { events, totals };
}

export function parseSchedule(doc) {
  const sched = rootOf(doc, 'StudentClassSchedule');
  let items = kids(path(sched, 'ClassLists'), 'ClassListing');
  if (!items.length) {
    const today = find(sched, 'TodayScheduleInfoData');
    items = today ? kids(find(today, 'Classes') || today, 'ClassInfo') : [];
  }
  return items.map((c) => ({
    period: attr(c, 'Period'),
    name: attr(c, 'CourseTitle') || attr(c, 'ClassName'),
    room: attr(c, 'RoomName') || attr(c, 'Room'),
    teacher: attr(c, 'Teacher') || attr(c, 'TeacherName'),
    teacherEmail: attr(c, 'TeacherEmail'),
  }));
}

export function parseCalendar(doc) {
  const cal = rootOf(doc, 'CalendarListing');
  return kids(path(cal, 'EventLists'), 'EventList').map((e) => ({
    date: attr(e, 'Date'),
    title: attr(e, 'Title'),
    type: attr(e, 'DayType') || 'Event',
  }));
}
