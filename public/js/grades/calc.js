// Grade math for MCPS, adapted from GradeFlow's calculator.
//
// MCPS secondary grading: A 90–100, B 80–89, C 70–79, D 60–69, E below 60 (no plus/minus;
// percentages round half up, so 89.5 is an A). Grade points A 4, B 3, C 2, D 1, E 0, and
// Honors / AP / IB courses earn one extra point for an A, B or C on the weighted GPA.

export const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const POINTS = { A: 4, B: 3, C: 2, D: 1, E: 0, F: 0 };
const CUTOFFS = [
  ['A', 89.5],
  ['B', 79.5],
  ['C', 69.5],
  ['D', 59.5],
];

export function letterFromPercent(p) {
  if (p == null || !Number.isFinite(p)) return null;
  for (const [letter, min] of CUTOFFS) if (p >= min) return letter;
  return 'E';
}

// Lowest percentage that earns a letter.
export const minPercentFor = (letter) => CUTOFFS.find(([l]) => l === letter)?.[1] ?? 0;

// StudentVUE marks can read "A", "B+", "92.4%" or "A (92%)"; reduce them to an MCPS letter.
export function letterOf(mark, percent = null) {
  const m = String(mark || '')
    .trim()
    .toUpperCase()
    .match(/^([A-F])/);
  if (m) return m[1] === 'F' ? 'E' : m[1];
  const n = parseFloat(String(mark || '').replace(/[%,]/g, ''));
  return letterFromPercent(Number.isFinite(n) ? n : percent);
}

export const isWeightedCourse = (title = '') => /\b(AP|HN|HON|HONORS|IB)\b/i.test(title);

export function coursePoints(course, { weighted = false } = {}) {
  const letter = letterOf(course.mark, course.scoreRaw);
  if (!letter) return null;
  const base = POINTS[letter];
  return weighted && isWeightedCourse(course.title) && base >= 2 ? base + 1 : base;
}

const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

export function gpa(courses, opts) {
  return mean(courses.map((c) => coursePoints(c, opts)).filter((v) => v != null));
}

export function average(courses) {
  return mean(courses.map((c) => c.scoreRaw).filter((v) => v != null && Number.isFinite(v)));
}

// MCPS semester grade from two marking-period letters: average their points, rounding .5 up
// (A+B → A, A+C → B, B+E → C, C+E → D).
export function semesterLetter(a, b) {
  if (!a || !b) return a || b || null;
  const avg = (POINTS[a] + POINTS[b]) / 2;
  return ['E', 'D', 'C', 'B', 'A'][Math.min(4, Math.floor(avg + 0.5))];
}

// A grade's colour token in Spark's palette.
export function gradeTone(letter) {
  return { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' }[letter] || 'none';
}

/* ----------------------------- course what-if ----------------------------- */

/**
 * Recomputes a course grade from its assignments, applying what-if score edits and made-up
 * assignments. Weighted by category when StudentVUE reports weights (MCPS: "All Tasks /
 * Assessments" 90%, "Practice/Preparation" 10%), otherwise total points.
 */
export function computeCourse(course, { overrides = {}, hypos = [] } = {}) {
  const items = [];
  for (const a of course.assignments) {
    const ov = overrides[a.id];
    const earned = ov?.earned != null ? ov.earned : a.pointsEarned;
    const possible = ov?.possible != null ? ov.possible : a.pointsPossible;
    if (ov?.excluded) continue;
    if (earned != null && possible != null && possible > 0) {
      items.push({ type: a.type || 'Other', earned, possible });
    }
  }
  for (const h of hypos) {
    if (h.possible > 0) items.push({ type: h.type || 'Other', earned: h.earned, possible: h.possible });
  }

  const defs = course.categories.filter((c) => c.weight != null && c.weight > 0);
  if (defs.length) {
    const used = new Set();
    const categories = defs.map((cat) => {
      let earned = 0;
      let possible = 0;
      let count = 0;
      items.forEach((it, idx) => {
        if (!used.has(idx) && it.type.toLowerCase() === cat.type.toLowerCase()) {
          used.add(idx);
          earned += it.earned;
          possible += it.possible;
          count++;
        }
      });
      return {
        type: cat.type,
        weight: cat.weight,
        earned,
        possible,
        count,
        percent: possible > 0 ? (earned / possible) * 100 : null,
      };
    });
    const graded = categories.filter((c) => c.percent != null);
    const total = graded.reduce((s, c) => s + c.weight, 0);
    const percent = total > 0 ? graded.reduce((s, c) => s + c.percent * c.weight, 0) / total : null;
    return { percent, categories, weighted: true };
  }

  const byType = new Map();
  for (const it of items) {
    const t = byType.get(it.type) || { type: it.type, weight: null, earned: 0, possible: 0, count: 0 };
    t.earned += it.earned;
    t.possible += it.possible;
    t.count++;
    byType.set(it.type, t);
  }
  const categories = [...byType.values()].map((c) => ({
    ...c,
    percent: c.possible > 0 ? (c.earned / c.possible) * 100 : null,
  }));
  const earned = items.reduce((s, i) => s + i.earned, 0);
  const possible = items.reduce((s, i) => s + i.possible, 0);
  return { percent: possible > 0 ? (earned / possible) * 100 : null, categories, weighted: false };
}

/**
 * The score needed on one more assignment (worth `possible` points in category `type`) to
 * reach `target` percent: { earned, percent, reachable }. earned 0 means the target is met
 * even with a zero; percent can exceed 100 (extra credit needed); reachable is false when
 * even triple the points wouldn't do it.
 */
export function scoreNeeded(course, { target, type, possible, overrides = {}, hypos = [] }) {
  if (!(possible > 0)) return null;
  const at = (earned) =>
    computeCourse(course, { overrides, hypos: [...hypos, { type, earned, possible }] }).percent ?? 0;
  if (at(0) >= target) return { earned: 0, percent: 0, reachable: true };
  const cap = possible * 3;
  if (at(cap) < target) return { earned: null, percent: null, reachable: false };
  let lo = 0;
  let hi = cap;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) >= target) hi = mid;
    else lo = mid;
  }
  const earned = Math.ceil(hi * 100) / 100;
  return { earned, percent: (earned / possible) * 100, reachable: true };
}

/* --------------------------------- dates ---------------------------------- */

// StudentVUE dates are "M/D/YYYY".
export function parseDate(s) {
  if (!s) return null;
  const us = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysFromToday(s, now = new Date()) {
  const d = parseDate(s);
  if (!d) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 864e5);
}

export function relativeDay(s, now = new Date()) {
  const diff = daysFromToday(s, now);
  if (diff == null) return s || '';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff <= 6) return `In ${diff} days`;
  if (diff < -1 && diff >= -6) return `${-diff} days ago`;
  return parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Ungraded assignments due from yesterday on, soonest first.
export function upcoming(courses, { now = new Date(), horizon = 21 } = {}) {
  const out = [];
  for (const c of courses) {
    for (const a of c.assignments) {
      if (a.graded) continue;
      const diff = daysFromToday(a.dueDate || a.date, now);
      if (diff == null || diff < -1 || diff > horizon) continue;
      out.push({ ...a, course: c, diff });
    }
  }
  return out.sort((a, b) => a.diff - b.diff);
}

// Most recently graded assignments across all classes.
export function recentGrades(courses, { limit = 6 } = {}) {
  return courses
    .flatMap((c) => c.assignments.filter((a) => a.graded).map((a) => ({ ...a, course: c, when: parseDate(a.date) })))
    .sort((a, b) => (b.when?.getTime() || 0) - (a.when?.getTime() || 0))
    .slice(0, limit);
}

// "ENGLISH 10 HN A" → "English 10 HN A"; keeps short codes (AP, AB, HN), numerals and acronyms.
export function prettyTitle(title = '') {
  const keep = /^([A-Z]{1,2}|III|VII|STEM|ESOL|JROTC|[A-Z]\d+|\d+\w*)$/;
  if (title !== title.toUpperCase()) return title;
  return title
    .split(/(\s+|\/|-)/)
    .map((w) => (keep.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join('');
}

// "Ramirez, Elena" → "Elena Ramirez"
export function personName(name = '') {
  const m = name.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : name;
}

export const fmtPct = (p, digits = 1) => (p == null || !Number.isFinite(p) ? '—' : `${p.toFixed(digits)}%`);
export const fmtNum = (n) => (n == null ? '—' : String(Math.round(n * 100) / 100));
