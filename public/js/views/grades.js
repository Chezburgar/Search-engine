// Spark Grades: StudentVUE grades for Montgomery County Public Schools, in Spark's style.
// A vanilla-JS take on GradeFlow: overview, class detail with what-if grades, schedule and
// attendance. Everything runs in the browser; the password never reaches Spark's servers on
// GitHub Pages (it goes to MCPS through the StudentVUE relay).

import { h, icon, fill, toast } from '../lib/dom.js';
import { STATIC, ROOT, gradesUrl, homeUrl } from '../lib/routes.js';
import { createStudentVue, relayTransport, serverTransport, MCPS, RELAY } from '../grades/studentvue.js';
import { demoGradebook, demoSchedule, demoAttendance, DEMO_STUDENT } from '../grades/demo.js';
import {
  letterOf,
  letterFromPercent,
  minPercentFor,
  gpa,
  average,
  gradeTone,
  isWeightedCourse,
  computeCourse,
  scoreNeeded,
  upcoming,
  recentGrades,
  relativeDay,
  prettyTitle,
  personName,
  fmtPct,
  fmtNum,
} from '../grades/calc.js';

const svue = createStudentVue({
  transport: STATIC ? relayTransport(RELAY) : serverTransport(`${ROOT}api/studentvue`),
});

/* --------------------------------- session -------------------------------- */

// "Keep me signed in" uses localStorage; otherwise the session ends with the tab.
const KEY = 'spark:grades';
const store = {
  load() {
    for (const s of [sessionStorage, localStorage]) {
      try {
        const v = JSON.parse(s.getItem(KEY) || 'null');
        if (v && (v.demo || (v.creds?.username && v.creds?.password))) return v;
      } catch {}
    }
    return null;
  },
  save(value, remember) {
    try {
      (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(value));
      (remember ? sessionStorage : localStorage).removeItem(KEY);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch {}
  },
};

let state = null;

function begin({ creds = null, student, demo = false }) {
  state = {
    creds,
    student,
    demo,
    books: new Map(),
    schedule: null,
    attendance: null,
    whatIf: new Map(),
    loadedAt: new Date(),
  };
}

function signOut() {
  store.clear();
  state = null;
}

// Cached loaders. Promises live outside any one render so navigating doesn't cancel them.
function gradebook(mp) {
  const key = mp == null ? 'current' : Number(mp);
  if (!state.books.has(key)) {
    const p = state.demo
      ? Promise.resolve(demoGradebook(mp == null ? undefined : Number(mp)))
      : svue.gradebook(state.creds, { reportPeriod: mp == null ? undefined : Number(mp) });
    state.books.set(key, p);
    const s = state;
    p.then(
      (gb) => s.books.has(gb.reportPeriod.index) || s.books.set(gb.reportPeriod.index, p),
      () => s.books.get(key) === p && s.books.delete(key)
    );
  }
  return state.books.get(key);
}

function loadOnce(name, demo, live) {
  if (!state[name]) {
    const s = state;
    const p = s.demo ? Promise.resolve(demo()) : live(s.creds);
    p.catch(() => s[name] === p && (s[name] = null));
    s[name] = p;
  }
  return state[name];
}

const schedule = () => loadOnce('schedule', demoSchedule, (c) => svue.schedule(c));
const attendance = () => loadOnce('attendance', demoAttendance, (c) => svue.attendance(c));

function refresh() {
  if (!state) return;
  state.books.clear();
  state.schedule = null;
  state.attendance = null;
  state.loadedAt = new Date();
}

/* -------------------------------- helpers --------------------------------- */

const tone = (letter) => `tone-${gradeTone(letter)}`;
const firstName = (s) => s?.nickname || (s?.name || '').split(/\s+/)[0] || 'there';

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

function card(title, iconName, ...body) {
  return h(
    'section',
    { class: 'gr-card' },
    title ? h('h2', { class: 'gr-card__title' }, icon(iconName), title) : null,
    ...body
  );
}

function loading(label = 'Loading your grades…') {
  return h('div', { class: 'gr-loading', role: 'status' }, h('span', { class: 'gr-spinner' }), label);
}

function ring(percent, letter, size = 132) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent ?? 0));
  const el = h('div', { class: `gr-ring ${tone(letter)}`, style: { width: `${size}px`, height: `${size}px` } });
  el.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="gr-ring__track" cx="60" cy="60" r="${r}"/><circle class="gr-ring__fill" cx="60" cy="60" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg>`;
  el.append(
    h(
      'div',
      { class: 'gr-ring__label' },
      h('span', { class: 'gr-ring__letter' }, letter || '—'),
      h('span', { class: 'gr-ring__pct' }, fmtPct(percent))
    )
  );
  return el;
}

function bar(percent, letter) {
  return h(
    'span',
    { class: `gr-bar ${tone(letter)}` },
    h('span', { style: { width: `${Math.max(0, Math.min(100, percent ?? 0))}%` } })
  );
}

function errorBlock(err, ctx, retry) {
  if (err?.kind === 'auth' && !state?.demo) {
    signOut();
    toast('Please sign in again.');
    ctx.navigate({}, { replace: true });
    return h('div');
  }
  return h(
    'div',
    { class: 'gr-error' },
    icon('alert'),
    h('h2', {}, 'Couldn’t load from MCPS StudentVUE'),
    h('p', {}, err?.message || 'Something went wrong.'),
    h('button', { class: 'btn btn--spark btn--sm', type: 'button', on: { click: retry } }, icon('refresh'), 'Try again')
  );
}

/* --------------------------------- login ---------------------------------- */

function renderLogin(root, ctx) {
  const user = h('input', {
    class: 'gr-input',
    id: 'gr-user',
    name: 'username',
    autocomplete: 'username',
    inputmode: 'numeric',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'e.g. 123456',
    required: true,
  });
  const pass = h('input', {
    class: 'gr-input',
    id: 'gr-pass',
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: '••••••••',
    required: true,
  });
  const reveal = h(
    'button',
    { class: 'gr-reveal', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false' },
    icon('eye')
  );
  reveal.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    fill(reveal, icon(show ? 'eyeOff' : 'eye'));
  });
  const remember = h('input', { type: 'checkbox', id: 'gr-remember', checked: true });
  const error = h('p', { class: 'gr-login__error', role: 'alert' });
  const submit = h('button', { class: 'btn btn--spark btn--wide gr-login__submit', type: 'submit' }, 'Sign in');

  const form = h(
    'form',
    { class: 'gr-login__form', novalidate: true },
    h('label', { class: 'gr-label', for: 'gr-user' }, 'Student ID'),
    user,
    h('label', { class: 'gr-label', for: 'gr-pass' }, 'Password'),
    h('div', { class: 'gr-pass' }, pass, reveal),
    h('label', { class: 'gr-check', for: 'gr-remember' }, remember, h('span', {}, 'Keep me signed in on this device')),
    error,
    submit,
    h(
      'p',
      { class: 'gr-login__hint' },
      'Use your MCPS StudentVUE login. ',
      h(
        'a',
        { href: `${MCPS.host}/PXP2_Password_Help.aspx`, target: '_blank', rel: 'noopener', 'data-external': '' },
        'Forgot your password?'
      )
    )
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = user.value.trim();
    const password = pass.value;
    if (!username || !password) {
      error.textContent = 'Enter your student ID and password.';
      (username ? pass : user).focus();
      return;
    }
    error.textContent = '';
    submit.disabled = true;
    submit.classList.add('is-loading');
    fill(submit, h('span', { class: 'gr-spinner gr-spinner--sm' }), 'Signing in…');
    try {
      const creds = { username, password };
      const student = await svue.studentInfo(creds);
      const { photo, ...saved } = student;
      store.save({ creds, student: saved }, remember.checked);
      begin({ creds, student });
      ctx.navigate({}, { replace: true });
    } catch (err) {
      error.textContent = err.message || 'Sign-in failed.';
      submit.disabled = false;
      submit.classList.remove('is-loading');
      fill(submit, 'Sign in');
      if (err.kind === 'auth') pass.select();
    }
  });

  const demo = h(
    'button',
    {
      class: 'btn btn--soft btn--wide',
      type: 'button',
      on: {
        click: () => {
          store.save({ demo: true, student: DEMO_STUDENT }, false);
          begin({ demo: true, student: DEMO_STUDENT });
          ctx.navigate({}, { replace: true });
        },
      },
    },
    icon('sparkle'),
    'Explore the demo'
  );

  root.replaceChildren(
    h(
      'div',
      { class: 'gr-login' },
      h('div', { class: 'home__glow', 'aria-hidden': 'true' }),
      h('a', { class: 'gr-login__back', href: homeUrl(), on: { click: ctx.home } }, icon('arrowLeft'), 'Spark Search'),
      h(
        'main',
        { class: 'gr-login__card' },
        h('img', { class: 'gr-login__mark', src: 'assets/spark-mark.png', alt: '', width: 64, height: 55 }),
        h('h1', { class: 'gr-login__title' }, 'Spark ', h('span', { class: 'gr-gradient' }, 'Grades')),
        h('p', { class: 'gr-login__district' }, h('span', { class: 'gr-mcps' }, MCPS.short), MCPS.name),
        form,
        h('div', { class: 'gr-or' }, h('span', {}, 'or')),
        demo,
        h('p', { class: 'gr-login__hint' }, 'Sample data — no account needed.')
      ),
      h(
        'p',
        { class: 'gr-fine' },
        icon('lock'),
        h(
          'span',
          {},
          STATIC
            ? 'Unofficial and not affiliated with MCPS or Edupoint. Browsers can’t talk to StudentVUE directly, so Spark Grades signs in through the same StudentVUE relay GradeFlow uses (studentvuelib.up.railway.app). Your password is kept only on this device, and only if you stay signed in.'
            : 'Unofficial and not affiliated with MCPS or Edupoint. Spark’s server passes your sign-in straight to MCPS StudentVUE and doesn’t store it. Your password is kept only on this device, and only if you stay signed in.'
        )
      )
    )
  );
  user.focus();
}

/* ---------------------------------- shell ---------------------------------- */

const VIEWS = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'schedule', label: 'Schedule', icon: 'clock' },
  { id: 'attendance', label: 'Attendance', icon: 'calendar' },
];

function shell(view, ctx) {
  const link = (params, cls, ...children) =>
    h(
      'a',
      {
        class: cls,
        href: gradesUrl(params),
        on: {
          click: (e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
            e.preventDefault();
            ctx.navigate(params);
          },
        },
      },
      ...children
    );
  const active = view === 'class' ? 'overview' : view;
  const nav = h(
    'nav',
    { class: 'gr-nav', 'aria-label': 'Grades sections' },
    VIEWS.map((v) => {
      const a = link(
        v.id === 'overview' ? { mp: ctx.mp } : { g: v.id },
        `gr-nav__item${v.id === active ? ' is-active' : ''}`,
        icon(v.icon),
        v.label
      );
      if (v.id === active) a.setAttribute('aria-current', 'page');
      return a;
    })
  );
  const s = state.student || {};
  const initials = (s.name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const avatar = s.photo
    ? h('img', { class: 'gr-avatar', src: `data:image/png;base64,${s.photo}`, alt: '' })
    : h('span', { class: 'gr-avatar', 'aria-hidden': 'true' }, initials);
  const main = h('main', { class: 'gr-main', id: 'main' });
  const el = h(
    'div',
    { class: 'gr' },
    h(
      'header',
      { class: 'gr-top' },
      h(
        'a',
        { class: 'gr-brand', href: homeUrl(), 'aria-label': 'Spark home', on: { click: ctx.home } },
        h('img', { src: 'assets/spark-mark.png', alt: '', width: 34, height: 29 }),
        h('span', { class: 'wordmark' }, 'Spark'),
        h('span', { class: 'gr-brand__tag' }, 'Grades')
      ),
      nav,
      h(
        'div',
        { class: 'gr-user' },
        h(
          'button',
          {
            class: 'iconbtn',
            type: 'button',
            title: 'Refresh from StudentVUE',
            'aria-label': 'Refresh grades',
            on: {
              click: () => {
                refresh();
                ctx.navigate(ctx.params, { replace: true });
                toast('Refreshing your grades…');
              },
            },
          },
          icon('refresh')
        ),
        h(
          'div',
          { class: 'gr-who' },
          avatar,
          h(
            'span',
            { class: 'gr-who__text' },
            h('span', { class: 'gr-who__name' }, s.name || 'Student'),
            h('span', { class: 'gr-who__school' }, s.school || MCPS.short)
          )
        ),
        h(
          'button',
          {
            class: 'iconbtn',
            type: 'button',
            title: 'Sign out',
            'aria-label': 'Sign out',
            on: {
              click: () => {
                signOut();
                ctx.navigate({});
              },
            },
          },
          icon('logout')
        )
      )
    ),
    state.demo
      ? h(
          'div',
          { class: 'gr-demo' },
          icon('sparkle'),
          'You’re exploring demo data. ',
          h(
            'button',
            {
              type: 'button',
              on: {
                click: () => {
                  signOut();
                  ctx.navigate({});
                },
              },
            },
            'Sign in with MCPS'
          )
        )
      : null,
    main
  );
  return { el, main, link };
}

/* -------------------------------- overview -------------------------------- */

function stat(label, value, sub, cls = '') {
  return h(
    'div',
    { class: `gr-stat ${cls}` },
    h('span', { class: 'gr-stat__label' }, label),
    h('span', { class: 'gr-stat__value' }, value),
    sub ? h('span', { class: 'gr-stat__sub' }, sub) : null
  );
}

async function renderOverview(main, ctx, link) {
  main.replaceChildren(loading());
  let gb;
  try {
    gb = await gradebook(ctx.mp);
  } catch (err) {
    if (!ctx.signal.aborted) main.replaceChildren(errorBlock(err, ctx, () => renderOverview(main, ctx, link)));
    return;
  }
  if (ctx.signal.aborted) return;
  const s = state.student || {};
  const courses = gb.courses;
  const mp = gb.reportPeriod.index;

  const select = h(
    'select',
    {
      class: 'gr-select',
      'aria-label': 'Marking period',
      on: { change: (e) => ctx.navigate({ mp: e.target.value }) },
    },
    gb.reportPeriods.map((p) => h('option', { value: String(p.index), selected: p.index === mp }, p.name))
  );

  const unweighted = gpa(courses);
  const weighted = gpa(courses, { weighted: true });
  const avg = average(courses);
  const graded = courses.filter((c) => letterOf(c.mark, c.scoreRaw));

  const classCard = (c) => {
    const letter = letterOf(c.mark, c.scoreRaw);
    const hasWhatIf = state.whatIf.has(`${mp}:${c.id}`);
    return link(
      { g: 'class', c: c.id, mp },
      `gr-class ${tone(letter)} rise`,
      h(
        'span',
        { class: 'gr-class__top' },
        h('span', { class: 'gr-period' }, c.period ? `Period ${c.period}` : 'Class'),
        isWeightedCourse(c.title) ? h('span', { class: 'gr-tag' }, 'Weighted') : null,
        hasWhatIf ? h('span', { class: 'gr-tag gr-tag--whatif' }, 'What-if') : null
      ),
      h('span', { class: 'gr-class__title' }, prettyTitle(c.title)),
      h('span', { class: 'gr-class__teacher' }, personName(c.teacher) || '—'),
      h(
        'span',
        { class: 'gr-class__grade' },
        h('span', { class: 'gr-letter' }, letter || '—'),
        h('span', { class: 'gr-class__pct' }, c.scoreRaw != null ? fmtPct(c.scoreRaw) : c.mark || 'No grade yet')
      ),
      bar(c.scoreRaw, letter)
    );
  };

  const due = upcoming(courses).slice(0, 7);
  const recent = recentGrades(courses);

  main.replaceChildren(
    h(
      'div',
      { class: 'gr-hero' },
      h(
        'div',
        {},
        h('h1', { class: 'gr-hero__title' }, `${greeting()}, ${firstName(s)}`),
        h(
          'p',
          { class: 'gr-hero__sub' },
          [
            s.grade ? `Grade ${s.grade}` : null,
            s.school,
            new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
          ]
            .filter(Boolean)
            .join(' · ')
        )
      ),
      h('label', { class: 'gr-period-pick' }, h('span', {}, 'Marking period'), select)
    ),
    h(
      'div',
      { class: 'gr-stats' },
      stat('GPA', unweighted != null ? unweighted.toFixed(2) : '—', 'Unweighted', 'gr-stat--spark'),
      stat('Weighted GPA', weighted != null ? weighted.toFixed(2) : '—', 'Honors, AP & IB +1'),
      stat('Average', fmtPct(avg), `${graded.length} graded class${graded.length === 1 ? '' : 'es'}`),
      stat(
        'Grade spread',
        h(
          'span',
          { class: 'gr-spread' },
          ['A', 'B', 'C', 'D', 'E'].map((l) => {
            const n = courses.filter((c) => letterOf(c.mark, c.scoreRaw) === l).length;
            return n ? h('span', { class: `gr-spread__item ${tone(l)}` }, h('b', {}, l), n) : null;
          })
        ),
        gb.reportPeriod.name
      )
    ),
    courses.length
      ? h('div', { class: 'gr-classes' }, courses.map(classCard))
      : h('div', { class: 'gr-empty' }, `No classes in ${gb.reportPeriod.name} yet.`),
    h(
      'div',
      { class: 'gr-cols' },
      card(
        'Coming up',
        'clock',
        due.length
          ? h(
              'ul',
              { class: 'gr-list' },
              due.map((a) =>
                h(
                  'li',
                  { class: 'gr-list__item' },
                  h('span', { class: `gr-when${a.diff <= 1 ? ' is-soon' : ''}` }, relativeDay(a.dueDate || a.date)),
                  h(
                    'span',
                    { class: 'gr-list__main' },
                    h('span', { class: 'gr-list__name' }, a.name),
                    h(
                      'span',
                      { class: 'gr-list__meta' },
                      `${prettyTitle(a.course.title)} · ${fmtNum(a.pointsPossible)} pts`
                    )
                  )
                )
              )
            )
          : h('p', { class: 'gr-muted' }, 'Nothing due in the next three weeks.')
      ),
      card(
        'Recent grades',
        'trend',
        recent.length
          ? h(
              'ul',
              { class: 'gr-list' },
              recent.map((a) => {
                const letter = letterFromPercent(a.percent);
                return h(
                  'li',
                  { class: 'gr-list__item' },
                  h('span', { class: `gr-chip ${tone(letter)}` }, fmtPct(a.percent, 0)),
                  h(
                    'span',
                    { class: 'gr-list__main' },
                    h('span', { class: 'gr-list__name' }, a.name),
                    h(
                      'span',
                      { class: 'gr-list__meta' },
                      `${prettyTitle(a.course.title)} · ${fmtNum(a.pointsEarned)}/${fmtNum(a.pointsPossible)} · ${relativeDay(a.date)}`
                    )
                  )
                );
              })
            )
          : h('p', { class: 'gr-muted' }, 'No graded assignments yet.')
      )
    ),
    h(
      'p',
      { class: 'gr-foot' },
      `From MCPS StudentVUE · loaded ${state.loadedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. `,
      'Grades are as your teachers entered them; check StudentVUE for anything official.'
    )
  );
}

/* ------------------------------ class detail ------------------------------ */

async function renderClass(main, ctx, link) {
  main.replaceChildren(loading('Loading class…'));
  let gb;
  try {
    gb = await gradebook(ctx.mp);
  } catch (err) {
    if (!ctx.signal.aborted) main.replaceChildren(errorBlock(err, ctx, () => renderClass(main, ctx, link)));
    return;
  }
  if (ctx.signal.aborted) return;
  const mp = gb.reportPeriod.index;
  const course = gb.courses.find((c) => c.id === ctx.course);
  const back = link({ mp }, 'gr-back', icon('arrowLeft'), 'All classes');
  if (!course) {
    main.replaceChildren(back, h('div', { class: 'gr-empty' }, 'That class isn’t in this marking period.'));
    return;
  }

  const key = `${mp}:${course.id}`;
  const wi = state.whatIf.get(key) || { overrides: {}, hypos: [] };
  const commit = () => {
    const active = Object.keys(wi.overrides).length || wi.hypos.length;
    if (active) state.whatIf.set(key, wi);
    else state.whatIf.delete(key);
    return Boolean(active);
  };

  // StudentVUE's own grade is the truth; what-if changes move it by the difference they make.
  const base = computeCourse(course).percent;
  const offset = course.scoreRaw != null && base != null ? course.scoreRaw - base : 0;
  const reported = course.scoreRaw ?? base;
  const reportedLetter = letterOf(course.mark, reported);
  const types = [
    ...new Set([...course.categories.map((c) => c.type), ...course.assignments.map((a) => a.type).filter(Boolean)]),
  ];
  if (!types.length) types.push('Other');

  const heroSlot = h('div', { class: 'gr-classhero__grade' });
  const catSlot = h('div');
  const needOut = h('p', { class: 'gr-need__out', 'aria-live': 'polite' });

  const target = h(
    'select',
    { class: 'gr-select', 'aria-label': 'Target grade' },
    ['A', 'B', 'C', 'D'].map((l) => h('option', { value: l }, `${l} (${Math.ceil(minPercentFor(l))}%)`))
  );
  target.value = reportedLetter && reportedLetter !== 'E' ? reportedLetter : 'A';
  const needType = h(
    'select',
    { class: 'gr-select', 'aria-label': 'Category' },
    types.map((t) => h('option', { value: t }, t))
  );
  const needPts = h('input', {
    class: 'gr-input gr-input--sm',
    type: 'number',
    min: '1',
    step: 'any',
    value: '100',
    'aria-label': 'Points possible',
  });

  function paint() {
    const active = commit();
    const now = computeCourse(course, wi);
    const shown = active && now.percent != null ? now.percent + offset : reported;
    const letter = letterFromPercent(shown) || reportedLetter;
    fill(
      heroSlot,
      ring(shown, letter),
      h(
        'div',
        { class: 'gr-classhero__info' },
        active
          ? [
              h('span', { class: 'gr-tag gr-tag--whatif' }, 'What-if'),
              h(
                'p',
                { class: 'gr-classhero__delta' },
                `${shown - reported >= 0 ? '+' : ''}${(shown - reported).toFixed(2)}% from your real grade (${reportedLetter || '—'}, ${fmtPct(reported)})`
              ),
              h(
                'button',
                {
                  class: 'btn btn--ghost btn--sm',
                  type: 'button',
                  on: {
                    click: () => {
                      wi.overrides = {};
                      wi.hypos = [];
                      renderClass(main, ctx, link);
                    },
                  },
                },
                icon('refresh'),
                'Reset what-if'
              ),
            ]
          : [
              h('p', { class: 'gr-classhero__note' }, course.mark ? `StudentVUE mark: ${course.mark}` : 'No mark yet'),
              h(
                'p',
                { class: 'gr-muted' },
                'Edit any score below, or add a made-up assignment, to see what-if grades.'
              ),
            ]
      )
    );

    fill(
      catSlot,
      now.categories.length
        ? h(
            'ul',
            { class: 'gr-cats' },
            now.categories.map((c) => {
              const l = letterFromPercent(c.percent);
              return h(
                'li',
                { class: 'gr-cat' },
                h(
                  'span',
                  { class: 'gr-cat__head' },
                  h('span', { class: 'gr-cat__name' }, c.type),
                  c.weight != null ? h('span', { class: 'gr-cat__weight' }, `${Math.round(c.weight * 100)}%`) : null,
                  h('span', { class: `gr-cat__pct ${tone(l)}` }, fmtPct(c.percent))
                ),
                bar(c.percent, l),
                h(
                  'span',
                  { class: 'gr-cat__pts' },
                  c.count
                    ? `${fmtNum(c.earned)} / ${fmtNum(c.possible)} points · ${c.count} graded`
                    : 'Nothing graded yet'
                )
              );
            })
          )
        : h('p', { class: 'gr-muted' }, 'No graded work yet.')
    );

    const goal = minPercentFor(target.value);
    const possible = Number(needPts.value);
    const need = scoreNeeded(course, {
      target: goal - offset,
      type: needType.value,
      possible,
      overrides: wi.overrides,
      hypos: wi.hypos,
    });
    if (!need) fill(needOut, 'Enter how many points the assignment is worth.');
    else if (!need.reachable)
      fill(
        needOut,
        `Even a perfect score won’t get you to ${target.value === 'A' ? 'an' : 'a'} ${target.value} with one ${fmtNum(possible)}-point assignment.`
      );
    else if (need.earned === 0)
      fill(
        needOut,
        h('b', {}, 'You’re set. '),
        `You keep ${target.value === 'A' ? 'an' : 'a'} ${target.value} even with a zero on it.`
      );
    else
      fill(
        needOut,
        'You need at least ',
        h(
          'b',
          { class: tone(letterFromPercent(Math.min(need.percent, 100))) },
          `${fmtNum(need.earned)} / ${fmtNum(possible)}`
        ),
        ` (${fmtPct(need.percent)})`,
        need.percent > 100 ? ' — that takes extra credit.' : '.'
      );
  }
  [target, needType].forEach((el) => el.addEventListener('change', paint));
  needPts.addEventListener('input', paint);

  const num = (input) => (input.value.trim() === '' ? null : Number(input.value));

  function assignmentRow(a) {
    const ov = wi.overrides[a.id] || {};
    const earned = h('input', {
      class: 'gr-score__in',
      type: 'number',
      inputmode: 'decimal',
      step: 'any',
      min: '0',
      placeholder: '–',
      value: ov.earned ?? a.pointsEarned ?? '',
      'aria-label': `Points earned on ${a.name}`,
    });
    const possible = h('input', {
      class: 'gr-score__in',
      type: 'number',
      inputmode: 'decimal',
      step: 'any',
      min: '0',
      value: ov.possible ?? a.pointsPossible ?? '',
      'aria-label': `Points possible on ${a.name}`,
    });
    const chip = h('span', { class: 'gr-chip' });
    const row = h(
      'li',
      { class: 'gr-asg' },
      h(
        'div',
        { class: 'gr-asg__main' },
        h('span', { class: 'gr-asg__name' }, a.name),
        h(
          'span',
          { class: 'gr-asg__meta' },
          [a.type, relativeDay(a.dueDate || a.date), a.graded ? null : 'Not graded'].filter(Boolean).join(' · ')
        ),
        a.notes ? h('span', { class: 'gr-asg__note' }, a.notes) : null
      ),
      h('div', { class: 'gr-score' }, earned, h('span', { class: 'gr-score__sep' }, '/'), possible),
      chip
    );
    const update = () => {
      const e = num(earned);
      const p = num(possible);
      const changed = (e != null && e !== a.pointsEarned) || (p != null && p !== a.pointsPossible);
      if (changed) wi.overrides[a.id] = { earned: e, possible: p };
      else delete wi.overrides[a.id];
      const ee = e ?? a.pointsEarned;
      const pp = p ?? a.pointsPossible;
      const pct = ee != null && pp > 0 ? (ee / pp) * 100 : null;
      chip.className = `gr-chip ${pct == null ? 'gr-chip--none' : tone(letterFromPercent(pct))}`;
      chip.textContent = pct == null ? '—' : fmtPct(pct, 0);
      row.classList.toggle('is-edited', changed);
    };
    for (const input of [earned, possible]) {
      input.addEventListener('input', () => (update(), paint()));
      // An emptied box falls back to the real score, so show it again.
      input.addEventListener('blur', () => {
        if (input.value.trim() === '') {
          const original = input === earned ? a.pointsEarned : a.pointsPossible;
          if (original != null) input.value = original;
        }
      });
    }
    update();
    return row;
  }

  function hypoRow(hy) {
    const earned = h('input', {
      class: 'gr-score__in',
      type: 'number',
      step: 'any',
      min: '0',
      value: hy.earned,
      'aria-label': `Points earned on ${hy.name}`,
    });
    const possible = h('input', {
      class: 'gr-score__in',
      type: 'number',
      step: 'any',
      min: '0',
      value: hy.possible,
      'aria-label': `Points possible on ${hy.name}`,
    });
    const chip = h('span', { class: 'gr-chip' });
    const update = () => {
      hy.earned = num(earned) ?? 0;
      hy.possible = num(possible) ?? 0;
      const pct = hy.possible > 0 ? (hy.earned / hy.possible) * 100 : null;
      chip.className = `gr-chip ${pct == null ? 'gr-chip--none' : tone(letterFromPercent(pct))}`;
      chip.textContent = pct == null ? '—' : fmtPct(pct, 0);
    };
    const row = h(
      'li',
      { class: 'gr-asg is-hypo' },
      h(
        'div',
        { class: 'gr-asg__main' },
        h('span', { class: 'gr-asg__name' }, hy.name, h('span', { class: 'gr-tag gr-tag--whatif' }, 'What-if')),
        h('span', { class: 'gr-asg__meta' }, hy.type)
      ),
      h('div', { class: 'gr-score' }, earned, h('span', { class: 'gr-score__sep' }, '/'), possible),
      chip,
      h(
        'button',
        {
          class: 'iconbtn iconbtn--sm gr-asg__remove',
          type: 'button',
          'aria-label': `Remove ${hy.name}`,
          on: {
            click: () => {
              wi.hypos = wi.hypos.filter((x) => x !== hy);
              row.remove();
              paint();
            },
          },
        },
        icon('trash')
      )
    );
    [earned, possible].forEach((i) => i.addEventListener('input', () => (update(), paint())));
    update();
    return row;
  }

  const list = h('ul', { class: 'gr-asgs' });
  const sorted = [...course.assignments].sort((a, b) => {
    const da = Date.parse(a.dueDate || a.date) || 0;
    const db = Date.parse(b.dueDate || b.date) || 0;
    return db - da;
  });
  list.append(...wi.hypos.map(hypoRow), ...sorted.map(assignmentRow));

  // Add a made-up assignment.
  const addName = h('input', {
    class: 'gr-input gr-input--sm',
    placeholder: 'Assignment name',
    'aria-label': 'Assignment name',
  });
  const addType = h(
    'select',
    { class: 'gr-select', 'aria-label': 'Category' },
    types.map((t) => h('option', { value: t }, t))
  );
  const addEarned = h('input', {
    class: 'gr-input gr-input--sm gr-input--num',
    type: 'number',
    step: 'any',
    min: '0',
    placeholder: 'Score',
    'aria-label': 'Points earned',
  });
  const addPossible = h('input', {
    class: 'gr-input gr-input--sm gr-input--num',
    type: 'number',
    step: 'any',
    min: '0',
    placeholder: 'Out of',
    value: '100',
    'aria-label': 'Points possible',
  });
  const addForm = h(
    'form',
    { class: 'gr-add' },
    addName,
    addType,
    h('span', { class: 'gr-add__pts' }, addEarned, '/', addPossible),
    h('button', { class: 'btn btn--spark btn--sm', type: 'submit' }, icon('plus'), 'Add')
  );
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const possible = num(addPossible);
    if (!(possible > 0)) return addPossible.focus();
    const hy = {
      name: addName.value.trim() || `What-if ${addType.value.toLowerCase()}`,
      type: addType.value,
      earned: num(addEarned) ?? possible,
      possible,
    };
    wi.hypos.unshift(hy);
    list.prepend(hypoRow(hy));
    addName.value = '';
    addEarned.value = '';
    paint();
  });

  const teacher = personName(course.teacher);
  main.replaceChildren(
    back,
    h(
      'section',
      { class: 'gr-classhero' },
      h(
        'div',
        { class: 'gr-classhero__head' },
        h(
          'span',
          { class: 'gr-period' },
          [course.period ? `Period ${course.period}` : null, gb.reportPeriod.name].filter(Boolean).join(' · ')
        ),
        h('h1', { class: 'gr-classhero__title' }, prettyTitle(course.title)),
        h(
          'p',
          { class: 'gr-classhero__meta' },
          teacher ? (course.teacherEmail ? h('a', { href: `mailto:${course.teacherEmail}` }, teacher) : teacher) : null,
          course.room ? h('span', {}, `Room ${course.room}`) : null,
          isWeightedCourse(course.title) ? h('span', { class: 'gr-tag' }, 'Weighted') : null
        )
      ),
      heroSlot
    ),
    h(
      'div',
      { class: 'gr-cols gr-cols--class' },
      card('Categories', 'layers', catSlot),
      card(
        'What do I need?',
        'calculator',
        h(
          'div',
          { class: 'gr-need' },
          h('label', {}, h('span', {}, 'To get'), target),
          h('label', {}, h('span', {}, 'on a'), needType),
          h('label', {}, h('span', {}, 'worth'), needPts, h('span', {}, 'points')),
          needOut
        )
      )
    ),
    card(
      `Assignments (${course.assignments.length})`,
      'book',
      h(
        'p',
        { class: 'gr-muted gr-card__hint' },
        'Type over any score to try a what-if. Nothing is sent to StudentVUE.'
      ),
      addForm,
      list
    )
  );
  paint();
}

/* ----------------------------- schedule & absences ------------------------ */

async function renderSchedule(main, ctx) {
  main.replaceChildren(loading('Loading your schedule…'));
  let classes;
  try {
    classes = await schedule();
  } catch (err) {
    if (!ctx.signal.aborted) main.replaceChildren(errorBlock(err, ctx, () => renderSchedule(main, ctx)));
    return;
  }
  if (ctx.signal.aborted) return;
  main.replaceChildren(
    h(
      'div',
      { class: 'gr-hero' },
      h(
        'div',
        {},
        h('h1', { class: 'gr-hero__title' }, 'Schedule'),
        h('p', { class: 'gr-hero__sub' }, state.student?.school || MCPS.name)
      )
    ),
    classes.length
      ? h(
          'ol',
          { class: 'gr-sched' },
          classes.map((c) =>
            h(
              'li',
              { class: 'gr-sched__item rise' },
              h('span', { class: 'gr-sched__period' }, c.period || '•'),
              h(
                'span',
                { class: 'gr-sched__main' },
                h('span', { class: 'gr-sched__name' }, prettyTitle(c.name)),
                h(
                  'span',
                  { class: 'gr-sched__meta' },
                  c.teacherEmail
                    ? h('a', { href: `mailto:${c.teacherEmail}` }, personName(c.teacher))
                    : personName(c.teacher),
                  c.room ? h('span', {}, `Room ${c.room}`) : null
                )
              ),
              isWeightedCourse(c.name) ? h('span', { class: 'gr-tag' }, 'Weighted') : null
            )
          )
        )
      : h('div', { class: 'gr-empty' }, 'No classes on your schedule right now.')
  );
}

async function renderAttendance(main, ctx) {
  main.replaceChildren(loading('Loading attendance…'));
  let at;
  try {
    at = await attendance();
  } catch (err) {
    if (!ctx.signal.aborted) main.replaceChildren(errorBlock(err, ctx, () => renderAttendance(main, ctx)));
    return;
  }
  if (ctx.signal.aborted) return;
  const t = at.totals;
  const events = [...at.events].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  main.replaceChildren(
    h(
      'div',
      { class: 'gr-hero' },
      h(
        'div',
        {},
        h('h1', { class: 'gr-hero__title' }, 'Attendance'),
        h('p', { class: 'gr-hero__sub' }, 'This school year')
      )
    ),
    h(
      'div',
      { class: 'gr-stats' },
      stat('Excused', String(t.excused), 'days', 'gr-stat--blue'),
      stat('Unexcused', String(t.unexcused), 'days', t.unexcused ? 'gr-stat--berry' : ''),
      stat('Tardies', String(t.tardy), 'times'),
      stat('Activities', String(t.activity), 'school activities')
    ),
    events.length
      ? h(
          'ul',
          { class: 'gr-absences' },
          events.map((e) =>
            h(
              'li',
              { class: 'gr-card gr-absence rise' },
              h(
                'div',
                { class: 'gr-absence__head' },
                h('span', { class: 'gr-absence__date' }, relativeDay(e.date)),
                h('span', { class: 'gr-tag' }, e.reason || 'Absence'),
                e.note ? h('span', { class: 'gr-muted' }, e.note) : null
              ),
              e.periods.length
                ? h(
                    'ul',
                    { class: 'gr-absence__periods' },
                    e.periods.map((p) =>
                      h('li', {}, h('b', {}, `P${p.period}`), ` ${prettyTitle(p.course)} — ${p.name || p.reason}`)
                    )
                  )
                : null
            )
          )
        )
      : h('div', { class: 'gr-empty' }, icon('check'), 'Perfect attendance so far.')
  );
}

/* ---------------------------------- entry ---------------------------------- */

export function renderGrades(root, { signal, navigate, home }) {
  if (!state) {
    const saved = store.load();
    if (saved) begin(saved);
  }
  const params = Object.fromEntries(new URL(location.href).searchParams);
  delete params.page;
  const ctx = {
    signal,
    navigate,
    home,
    params,
    mp: params.mp != null && /^\d+$/.test(params.mp) ? Number(params.mp) : null,
    course: params.c || null,
  };
  document.title = 'Spark Grades';
  if (!state) return renderLogin(root, ctx);

  const view = ['class', 'schedule', 'attendance'].includes(params.g) ? params.g : 'overview';
  const { el, main, link } = shell(view, ctx);
  root.replaceChildren(el);
  if (view === 'class') return renderClass(main, ctx, link);
  if (view === 'schedule') return renderSchedule(main, ctx);
  if (view === 'attendance') return renderAttendance(main, ctx);
  return renderOverview(main, ctx, link);
}
