// Made-up data so Spark Grades can be explored without an MCPS account.
// Dates are relative to today so "Upcoming" always has something in it.

const TASKS = 'All Tasks / Assessments';
const PRACTICE = 'Practice/Preparation';
const MCPS_WEIGHTS = [
  { type: TASKS, weight: 0.9 },
  { type: PRACTICE, weight: 0.1 },
];

function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

let n = 0;
function asg(name, type, earned, possible, offset, notes = '') {
  const graded = earned != null;
  return {
    id: `demo-${++n}`,
    name,
    type,
    date: day(offset),
    dueDate: day(offset),
    scoreString: graded ? `${earned} out of ${possible}` : 'Not Graded',
    points: graded ? `${earned.toFixed(2)} / ${possible.toFixed(4)}` : `${possible.toFixed(4)} Points Possible`,
    pointsEarned: earned,
    pointsPossible: possible,
    percent: graded ? (earned / possible) * 100 : null,
    notes,
    graded,
  };
}

function course(period, title, teacher, room, mark, scoreRaw, assignments) {
  return {
    id: `demo-${period}`,
    period: String(period),
    title,
    room,
    teacher,
    teacherEmail: `${teacher.split(',')[0].toLowerCase()}@demo.mcpsmd.test`,
    mark,
    scoreRaw,
    categories: MCPS_WEIGHTS.map((w) => ({ ...w, points: null, pointsPossible: null, percent: null, mark: '' })),
    assignments,
  };
}

function courses() {
  n = 0;
  return [
    course(1, 'AP CALCULUS AB A', 'Ramirez, Elena', '204', 'A', 91.6, [
      asg('Unit 5 Test: Applications of Derivatives', TASKS, 46, 50, -3),
      asg('Related Rates Quiz', TASKS, 18, 20, -9),
      asg('Optimization Practice Set', PRACTICE, 10, 10, -6),
      asg('Unit 4 Test: Contextual Derivatives', TASKS, 43, 50, -17),
      asg('Mean Value Theorem Warm-ups', PRACTICE, 9, 10, -12),
      asg('Unit 6 Test: Integration', TASKS, null, 50, 4, 'Calculators allowed on part B'),
    ]),
    course(2, 'ENGLISH 11 HN A', 'Okafor, Daniel', '118', 'B', 86.2, [
      asg('The Great Gatsby Analytical Essay', TASKS, 85, 100, -5),
      asg('Socratic Seminar: Chapters 1–4', TASKS, 18, 20, -12),
      asg('Reading Check: Chapter 5', PRACTICE, 4, 5, -8),
      asg('Vocabulary Unit 3', PRACTICE, 9, 10, -14),
      asg('Research Paper Proposal', TASKS, null, 25, 6),
    ]),
    course(3, 'CHEMISTRY HN A', 'Chen, Wei', '311', 'A', 93.8, [
      asg('Stoichiometry Lab Report', TASKS, 48, 50, -4),
      asg('Unit 3 Test: Moles', TASKS, 92, 100, -15),
      asg('Lab Safety Quiz', PRACTICE, 10, 10, -30),
      asg('Limiting Reagent Worksheet', PRACTICE, 8, 10, -7),
      asg('Gas Laws Quiz', TASKS, null, 30, 2),
    ]),
    course(4, 'US HISTORY A', 'Brooks, Angela', '226', 'C', 77.4, [
      asg('Reconstruction DBQ', TASKS, 31, 40, -6),
      asg('Unit 2 Test: Industrialization', TASKS, 71, 100, -13),
      asg('Primary Source Analysis', PRACTICE, 8, 10, -10),
      asg('Gilded Age Project', TASKS, null, 50, 9),
    ]),
    course(5, 'SPANISH 3 A', 'Morales, Lucía', '140', 'B', 84.1, [
      asg('Presentación oral: Mi comunidad', TASKS, 42, 50, -2),
      asg('Prueba: El subjuntivo', TASKS, 33, 40, -11),
      asg('Tarea: Vocabulario 4', PRACTICE, 10, 10, -5),
    ]),
    course(6, 'AP COMPUTER SCIENCE A A', 'Patel, Ravi', '305', 'A', 97.3, [
      asg('ArrayList Lab', TASKS, 30, 30, -3),
      asg('Unit 6 Test: Arrays', TASKS, 48, 50, -10),
      asg('Codingbat Practice', PRACTICE, 10, 10, -6),
      asg('FRQ Practice: Classes', TASKS, null, 9, 1),
    ]),
    course(7, 'PHYSICAL EDUCATION 2', 'Johnson, Mark', 'GYM', 'A', 100, [
      asg('Fitness Assessment', TASKS, 20, 20, -8),
      asg('Participation Week 6', PRACTICE, 10, 10, -2),
    ]),
  ];
}

const PERIODS = [
  { index: 0, name: 'MP1 Interim' },
  { index: 1, name: 'MP1' },
  { index: 2, name: 'MP2 Interim' },
  { index: 3, name: 'MP2' },
  { index: 4, name: 'MP3 Interim' },
  { index: 5, name: 'MP3' },
  { index: 6, name: 'MP4 Interim' },
  { index: 7, name: 'MP4' },
];

export function demoGradebook(reportPeriod = 1) {
  const index = PERIODS.some((p) => p.index === reportPeriod) ? reportPeriod : 1;
  const list = courses();
  // Other marking periods: same classes, nudged scores, so switching periods visibly changes.
  if (index !== 1) {
    const shift = [0, 0, -2.4, -3.1, 1.2, 0.8, -1.5, 2.2][index];
    for (const c of list) {
      c.scoreRaw = Math.min(100, Math.max(0, Math.round((c.scoreRaw + shift + (c.period % 3) - 1) * 10) / 10));
      c.mark = c.scoreRaw >= 89.5 ? 'A' : c.scoreRaw >= 79.5 ? 'B' : c.scoreRaw >= 69.5 ? 'C' : 'D';
    }
  }
  return {
    reportPeriod: { ...PERIODS.find((p) => p.index === index), startDate: '', endDate: '' },
    reportPeriods: PERIODS.map((p) => ({ ...p, startDate: '', endDate: '' })),
    courses: list,
  };
}

export const DEMO_STUDENT = {
  name: 'Jordan Rivera',
  nickname: 'Jordan',
  studentId: '000000',
  grade: '11',
  school: 'Demo High School',
  email: '',
  photo: '',
  counselor: 'Ms. Nguyen',
};

export const demoSchedule = () =>
  courses().map((c) => ({
    period: c.period,
    name: c.title,
    room: c.room,
    teacher: c.teacher,
    teacherEmail: c.teacherEmail,
  }));

export const demoAttendance = () => ({
  events: [
    {
      date: day(-16),
      reason: 'Illness',
      note: '',
      periods: [1, 2, 3, 4, 5, 6, 7].map((p) => ({
        period: String(p),
        name: 'Excused Absence',
        reason: 'Illness',
        course: courses()[p - 1].title,
        staff: '',
      })),
    },
    {
      date: day(-9),
      reason: 'Tardy',
      note: '',
      periods: [{ period: '1', name: 'Tardy', reason: 'Tardy', course: 'AP CALCULUS AB A', staff: 'Ramirez, Elena' }],
    },
    {
      date: day(-30),
      reason: 'School Activity',
      note: 'Field trip',
      periods: [
        { period: '4', name: 'Activity', reason: 'Field trip', course: 'US HISTORY A', staff: 'Brooks, Angela' },
      ],
    },
  ],
  totals: { excused: 1, unexcused: 0, tardy: 1, activity: 1 },
});
