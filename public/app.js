// app.js — Quiz App frontend (plain JavaScript, hash router)
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $tab = document.getElementById('tabbar');
const $chip = document.getElementById('userChip');
let me = null;

// ---------- utilities ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Request failed'); e.status = res.status; e.data = data; throw e; }
  return data;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, ms = 3200) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function fmtDate(d) { return d ? new Date(d).toLocaleString() : '\u2014'; }
function fmtTime(sec) {
  if (sec == null) return '\u2014';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}
function diffBadge(d) { return `<span class="badge diff-${esc(d)}">${esc(d.replace('_', '\u2013'))}</span>`; }
function pct(p, t) { return t ? Math.round(100 * p / t) + '%' : '\u2014'; }
function go(hash) { location.hash = hash; }

// ---------- auth & nav ----------
async function refreshMe() {
  try { me = (await api('/api/me')).user; } catch { me = null; }
  renderNav();
}
function renderNav() {
  const links = me
    ? [['#/', 'Home'], ['#/quizzes', 'Quizzes'], ['#/leaderboard', 'Leaderboard'], ['#/history', 'History'],
       ...(me.role === 'admin' ? [['#/admin', 'Admin']] : []), ['#/profile', 'Profile']]
    : [['#/', 'Home'], ['#/login', 'Log In'], ['#/register', 'Register']];
  const current = location.hash || '#/';
  $nav.innerHTML = links.map(([h, l]) => `<a href="${h}" class="${current.startsWith(h) && (h !== '#/' || current === '#/') ? 'active' : ''}">${l}</a>`).join('');
  $tab.innerHTML = me ? [['#/', 'Home'], ['#/quizzes', 'Quizzes'], ['#/leaderboard', 'Leaderboard'], ['#/history', 'History']].map(([h, l]) => `<a href="${h}">${l}</a>`).join('') : '';
  $chip.innerHTML = me
    ? `<span class="avatar">${esc(me.username[0])}</span><span class="small">${esc(me.username)}</span> <button class="btn small quiet" id="logoutBtn">Log out</button>`
    : '';
  const lb = document.getElementById('logoutBtn');
  if (lb) lb.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); me = null; go('#/login'); renderNav(); };
}

// ---------- views ----------
function landing() {
  if (me) return dashboard();
  $app.innerHTML = `
    <div class="card" style="text-align:center;padding:48px">
      <h1>Welcome to QuizApp</h1>
      <p class="muted">Five quizzes, easy to expert. Take quizzes, track your history, climb the leaderboards.</p>
      <div class="row" style="justify-content:center">
        <a class="btn" href="#/register">Register</a>
        <a class="btn secondary" href="#/login">Log In</a>
      </div>
    </div>`;
}

async function dashboard() {
  const { quizzes } = await api('/api/quizzes');
  const first = !quizzes.length ? '' : '';
  $app.innerHTML = `
    <h1>Hi, ${esc(me.username)} \u{1F44B}</h1>
    <div class="alert info">Pick a quiz below to start. Your scores and history are saved automatically.</div>
    ${quizzes.map(quizCard).join('')}`;
}

function quizCard(z) {
  const resume = z.has_in_progress ? `<a class="btn small" href="#/play/${z.id}">Resume</a>` : '';
  const time = z.time_limit_seconds ? `\u23F1 ${Math.round(z.time_limit_seconds / 60)} min` : 'No time limit';
  return `<div class="card">
    <div class="row spread">
      <div><h2>${esc(z.title)}</h2>
        <div class="row">${diffBadge(z.difficulty)} <span class="badge" style="background:var(--bg)">${z.question_count} questions</span> <span class="muted small">${esc(time)}</span></div>
        <p class="muted small">${esc(z.topic)}</p></div>
      <div class="row">${resume}<a class="btn small" href="#/play/${z.id}">Play</a><a class="btn small quiet" href="#/leaderboard/${z.id}">Leaderboard</a></div>
    </div></div>`;
}

function loginView() {
  $app.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto">
    <h1>Log In</h1><div id="formErr"></div>
    <form id="loginForm">
      <label>Username or email</label><input name="username" required autocomplete="username">
      <label>Password</label><input name="password" type="password" required autocomplete="current-password">
      <div style="margin-top:16px"><button class="btn" style="width:100%">Log In</button></div>
    </form>
    <p class="small muted" style="margin-top:12px">No account? <a href="#/register">Register</a></p></div>`;
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
      me = user; toast('Welcome back, ' + user.username); go('#/'); renderNav();
    } catch (err) { document.getElementById('formErr').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };
}

function registerView() {
  $app.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto">
    <h1>Register</h1><div id="formErr"></div>
    <form id="regForm">
      <label>Username</label><input name="username" required minlength="3" maxlength="30">
      <label>Email</label><input name="email" type="email" required>
      <label>Password (8+ characters)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
      <div style="margin-top:16px"><button class="btn" style="width:100%">Create Account</button></div>
    </form>
    <p class="small muted" style="margin-top:12px">Have an account? <a href="#/login">Log In</a></p></div>`;
  document.getElementById('regForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('/api/auth/register', { method: 'POST', body: { username: f.get('username'), email: f.get('email'), password: f.get('password') } });
      me = user; toast('Account created. Welcome, ' + user.username + '!'); go('#/'); renderNav();
    } catch (err) { document.getElementById('formErr').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };
}

// ---------- quiz list & play ----------
async function quizList() {
  const { quizzes } = await api('/api/quizzes');
  $app.innerHTML = `<h1>Quizzes</h1>` + (quizzes.length ? quizzes.map(quizCard).join('') : '<div class="card">No published quizzes yet.</div>');
}

// play state
let play = null;

async function startPlay(quizId) {
  const { attempt, resumed, deadline } = await api(`/api/quizzes/${quizId}/attempts`, { method: 'POST' });
  const quiz = (await api(`/api/quizzes/${quizId}`)).quiz;
  const pub = await api(`/api/quizzes/${quizId}/questions`); // snapshot questions (no correct answers)
  const saved = resumed ? (await api(`/api/attempts/${attempt.id}/answers`)).answers : [];
  play = {
    quiz, attempt, deadline: deadline ? new Date(deadline) : null,
    questions: pub.questions, index: 0,
    answers: Object.fromEntries(saved.map(s => [s.question_id, s.chosen_choice])),
  };
  renderPlay();
}

async function renderPlay() {
  const p = play;
  const q = p.questions[p.index];
  const chosen = p.answers[q.id];
  $app.innerHTML = `
    <div class="timer-chip ${p.deadline && p.deadline - Date.now() < 60000 ? 'warn' : ''}" id="timer"></div>
    <div class="card">
      <div class="row spread small muted"><span>Question ${p.index + 1} of ${p.questions.length}</span><span>${esc(p.quiz.title)}</span></div>
      <h2 style="margin-top:8px">${esc(q.question_text)}</h2>
      ${['a', 'b', 'c', 'd'].map(c => `
        <div class="choice ${chosen === c ? 'selected' : ''}" data-choice="${c}">
          <span class="letter">${c.toUpperCase()}</span><span>${esc(q['choice_' + c])}</span>
        </div>`).join('')}
      <div class="row spread" style="margin-top:16px">
        <button class="btn quiet" id="prevBtn" ${p.index === 0 ? 'disabled' : ''}>Back</button>
        <div class="row">
          <button class="btn danger" id="abandonBtn">Discard attempt</button>
          ${p.index < p.questions.length - 1
            ? '<button class="btn" id="nextBtn">Next</button>'
            : '<button class="btn" id="finishBtn">Finish</button>'}
        </div>
      </div>
    </div>`;
  document.querySelectorAll('.choice').forEach(el => el.onclick = async () => {
    const c = el.dataset.choice;
    const ms = 0;
    p.answers[q.id] = c;
    el.parentElement.querySelectorAll('.choice').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    try {
      await api(`/api/attempts/${p.attempt.id}`, { method: 'PATCH', body: { answers: [{ question_id: q.id, chosen: c, ms_taken: ms }] } });
    } catch (e) {
      if (e.data && e.data.expired) { toast('Time is up \u2014 finishing attempt'); return finishAttempt(); }
      toast(e.message);
    }
  });
  const prev = document.getElementById('prevBtn');
  if (prev) prev.onclick = () => { p.index--; renderPlay(); };
  const next = document.getElementById('nextBtn');
  if (next) next.onclick = () => { p.index++; renderPlay(); };
  const fin = document.getElementById('finishBtn');
  if (fin) fin.onclick = finishAttempt;
  const ab = document.getElementById('abandonBtn');
  if (ab) ab.onclick = async () => {
    if (!confirm('Discard this attempt? It will be marked abandoned and will not count.')) return;
    await api(`/api/attempts/${p.attempt.id}/abandon`, { method: 'POST' });
    toast('Attempt discarded'); play = null; go('#/quizzes');
  };
}

async function finishAttempt() {
  const id = play.attempt.id;
  try {
    const { expired } = await api(`/api/attempts/${id}/finish`, { method: 'POST' });
    if (expired) toast('Time was up \u2014 unanswered questions scored 0');
    play = null;
    go(`#/results/${id}`);
  } catch (e) { toast(e.message); }
}

// countdown chip
setInterval(() => {
  const el = document.getElementById('timer');
  if (!el || !play || !play.deadline) { if (el && (!play || !play.deadline)) el.style.display = 'none'; return; }
  el.style.display = '';
  const ms = play.deadline - Date.now();
  if (ms <= 0) { el.textContent = 'Time is up'; return; }
  const s = Math.floor(ms / 1000);
  el.textContent = `\u23F1 ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} left`;
  el.classList.toggle('warn', s < 60);
}, 500);

async function resultsView(attemptId) {
  const { attempt, breakdown } = await api(`/api/attempts/${attemptId}/results`);
  const total = attempt.total_questions || 0;
  const correct = attempt.points ?? 0;
  const elapsed = attempt.finished_at && attempt.started_at
    ? (new Date(attempt.finished_at) - new Date(attempt.started_at)) / 1000 : null;
  $app.innerHTML = `
    <h1>Results</h1>
    <div class="card" style="text-align:center">
      <p class="muted">${attempt.status === 'completed' ? 'Completed' : esc(attempt.status)} \u00b7 ${fmtDate(attempt.finished_at)}</p>
      <div style="font-size:44px;font-weight:800">${correct} / ${total}</div>
      <p style="font-size:20px;font-weight:700">${pct(correct, total)} correct</p>
      <p class="muted small">Time taken: ${fmtTime(elapsed)}</p>
      <div class="row" style="justify-content:center;margin-top:12px">
        <a class="btn" href="#/play/${attempt.quiz_id}">Retry quiz</a>
        <a class="btn secondary" href="#/history">History</a>
        <a class="btn quiet" href="#/leaderboard/${attempt.quiz_id}">Leaderboard</a>
      </div>
    </div>
    <div class="card"><h2>Question breakdown</h2>
      <table><tbody>
      ${breakdown.map(b => `<tr class="${b.is_correct ? '' : ''}">
        <td>${b.is_correct ? '\u2705' : '\u274C'}</td>
        <td><b>${esc(b.question_text)}</b><br><span class="small muted">Your answer: ${esc(b.chosen_choice?.toUpperCase())} \u00b7 Correct: ${esc(b.correct_choice.toUpperCase())}</span></td>
      </tr>`).join('')}
      </tbody></table>
      ${breakdown.length < total ? `<p class="muted small">${total - breakdown.length} question(s) unanswered.</p>` : ''}
    </div>`;
}

async function historyView() {
  const { attempts } = await api('/api/me/attempts');
  $app.innerHTML = `<h1>My History</h1>
    <div class="card">${attempts.length ? `<table>
      <thead><tr><th>Quiz</th><th>Score</th><th>%</th><th>Time taken</th><th>Finished</th><th></th></tr></thead>
      <tbody>${attempts.map(a => `<tr>
        <td>${esc(a.quiz_title)} ${diffBadge(a.difficulty)}</td>
        <td><b>${a.points}/${a.total_questions}</b></td><td>${pct(a.points, a.total_questions)}</td>
        <td class="small">${fmtTime(a.elapsed ? Number(a.elapsed.seconds ?? 0) : null)}</td>
        <td class="small">${fmtDate(a.finished_at)}</td>
        <td><a class="btn small quiet" href="#/results/${a.id}">View</a></td>
      </tr>`).join('')}</tbody></table>`
      : '<p class="muted">No completed attempts yet. <a href="#/quizzes">Take a quiz</a>!</p>'}</div>`;
}

// ---------- leaderboards ----------
function rankRows(rows, keyFn, meId, extraCell) {
  // competition ranking 1,2,2,4
  let rank = 0, prevKey = null, shown = 0;
  return rows.map(r => {
    const k = keyFn(r);
    shown++;
    if (k !== prevKey) { rank = shown; prevKey = k; }
    return { ...r, rank };
  }).map(r => `<tr class="${r.id === meId ? 'me' : ''}">
      <td class="rank ${r.rank <= 3 ? 'medal-' + r.rank : ''}">${r.rank}</td>
      <td><span class="avatar">${esc(String(r.username)[0])}</span> ${esc(r.username)}${r.id === meId ? ' <span class="badge diff-easy_medium">You</span>' : ''}</td>
      ${extraCell(r)}</tr>`).join('');
}

async function leaderboardView(quizId) {
  if (!quizId) {
    const { leaderboard } = await api('/api/leaderboard/overall');
    $app.innerHTML = `<h1>Overall Leaderboard</h1>
      <div class="card"><p class="muted small">Ranked by total completed quiz attempts (spec O-1). Ties share rank.</p>
      ${leaderboard.length ? `<table><thead><tr><th>Rank</th><th>Player</th><th>Completed attempts</th><th>Quizzes played</th><th>Member since</th></tr></thead>
      <tbody>${rankRows(leaderboard, r => +r.total_attempts, me?.id, r => `
        <td><b>${r.total_attempts}</b></td><td>${r.quizzes_played}</td><td class="small">${fmtDate(r.joined_at)}</td>`)}
      </tbody></table>` : '<p class="muted">No completed attempts yet.</p>'}</div>`;
    return;
  }
  const quiz = (await api(`/api/quizzes/${quizId}`)).quiz;
  const { leaderboard } = await api(`/api/leaderboard/quizzes/${quizId}`);
  $app.innerHTML = `<h1>${esc(quiz.title)} Leaderboard</h1>
    <div class="card"><p class="muted small">Ranked by best score; ties broken by first to reach it, then fewer attempts, then username (Q-1..Q-6).</p>
    ${leaderboard.length ? `<table><thead><tr><th>Rank</th><th>Player</th><th>Best score</th><th>Attempts</th><th>Best achieved</th></tr></thead>
    <tbody>${rankRows(leaderboard, r => r.best_points, me?.id, r => `
      <td><b>${r.best_points}</b> \u00b7 ${pct(r.best_points, quiz.question_count)}</td>
      <td>${r.attempts}</td><td class="small">${fmtDate(r.best_achieved_at)}</td>`)}
    </tbody></table>` : '<p class="muted">No completed attempts yet.</p>'}</div>
    <a class="btn secondary" href="#/leaderboard">\u2190 All leaderboards</a>`;
}

// ---------- profile ----------
function profileView() {
  $app.innerHTML = `<h1>Profile</h1><div id="formErr"></div>
    <div class="card">
      <p><b>Username:</b> ${esc(me.username)} <span class="muted small">(rankings are keyed to your account, so name display updates everywhere)</span></p>
      <p><b>Email:</b> ${esc(me.email)}</p>
      <p><b>Role:</b> ${esc(me.role)}</p>
    </div>
    <div class="card"><h2>Change password</h2>
      <form id="pwForm">
        <label>Current password</label><input name="currentPassword" type="password" required autocomplete="current-password">
        <label>New password (8+ characters)</label><input name="newPassword" type="password" minlength="8" required autocomplete="new-password">
        <div style="margin-top:12px"><button class="btn">Update password</button></div>
      </form></div>
    <div class="card"><h2>Danger zone</h2>
      <p class="muted small">Deleting your account removes you and your entries from all leaderboards. This cannot be undone.</p>
      <button class="btn danger" id="delBtn">Delete my account</button></div>`;
  document.getElementById('pwForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/me', { method: 'PATCH', body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') } });
      toast('Password updated'); e.target.reset();
    } catch (err) { document.getElementById('formErr').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
  };
  document.getElementById('delBtn').onclick = async () => {
    if (!confirm('Delete your account and all your scores? This cannot be undone.')) return;
    await api('/api/me', { method: 'DELETE' });
    me = null; toast('Account deleted'); go('#/'); renderNav();
  };
}

// ---------- admin ----------
function adminHome() {
  $app.innerHTML = `<h1>Admin</h1>
    <div class="grid cols2">
      <a class="card" style="text-decoration:none;color:inherit" href="#/admin/quizzes"><h2>\u270F\uFE0F Quizzes & questions</h2><p class="muted small">Edit quizzes, questions, CSV import</p></a>
      <a class="card" style="text-decoration:none;color:inherit" href="#/admin/users"><h2>\uD83D\uDC65 Users</h2><p class="muted small">Roles, disable accounts, view history</p></a>
      <a class="card" style="text-decoration:none;color:inherit" href="#/admin/stats"><h2>\uD83D\uDCCA Analytics</h2><p class="muted small">Usage stats & question miss rates</p></a>
    </div>`;
}

async function adminQuizzes() {
  const { quizzes } = await api('/api/admin/quizzes');
  $app.innerHTML = `<div class="row spread"><h1>Quizzes</h1><button class="btn" id="newQuizBtn">+ New quiz</button></div>
    <div id="quizForm"></div>
    ${quizzes.map(z => `<div class="card">
      <div class="row spread">
        <div><h2>${esc(z.title)} ${z.is_published ? '' : '<span class="badge diff-medium">Unpublished</span>'}</h2>
        <div class="row">${diffBadge(z.difficulty)} <span class="badge" style="background:var(--bg)">${z.question_count} questions</span>
        <span class="badge" style="background:var(--bg)">${z.attempt_count} attempts</span>
        <span class="muted small">${z.time_limit_seconds ? Math.round(z.time_limit_seconds / 60) + ' min' : 'untimed'}</span></div></div>
        <div class="row"><button class="btn small" data-edit="${z.id}">Edit questions</button></div>
      </div></div>`).join('')}`;
  document.getElementById('newQuizBtn').onclick = () => go('#/admin/quiz-new');
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => go('#/admin/quiz/' + b.dataset.edit));
}

function quizMetaForm() {
  $app.innerHTML = `<h1>New quiz</h1>
    <div class="card"><form id="quizCreate">
      <label>Title</label><input name="title" required>
      <label>Topic</label><input name="topic">
      <label>Difficulty</label><select name="difficulty">
        <option value="easy">Easy</option><option value="easy_medium">Easy\u2013Medium</option>
        <option value="medium">Medium</option><option value="hard">Hard</option><option value="expert">Expert</option>
      </select>
      <label>Time limit in minutes (empty = untimed)</label><input name="minutes" type="number" min="1">
      <div style="margin-top:12px"><button class="btn">Create quiz</button>
      <a class="btn quiet" href="#/admin/quizzes">Cancel</a></div>
    </form></div>`;
  document.getElementById('quizCreate').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const minutes = f.get('minutes');
    try {
      const { quiz } = await api('/api/admin/quizzes', { method: 'POST', body: {
        title: f.get('title'), topic: f.get('topic'), difficulty: f.get('difficulty'),
        time_limit_seconds: minutes ? +minutes * 60 : null }});
      toast('Quiz created'); go('#/admin/quiz/' + quiz.id);
    } catch (err) { toast(err.message); }
  };
}

async function adminQuizEditor(quizId) {
  const quiz = (await api('/api/admin/quizzes')).quizzes.find(z => z.id == quizId);
  if (!quiz) { toast('Quiz not found'); return go('#/admin/quizzes'); }
  const questions = (await api(`/api/admin/quizzes/${quizId}/questions`)).questions;
  const hasAttempts = quiz.attempt_count > 0;
  $app.innerHTML = `
    <div class="row spread"><h1>Edit: ${esc(quiz.title)}</h1><a class="btn quiet small" href="#/admin/quizzes">\u2190 Back</a></div>
    ${hasAttempts ? '<div class="alert error">Editing questions mid-competition makes leaderboard points incomparable. Past scores are never recomputed.</div>' : ''}
    <div class="card"><h2>Quiz settings</h2>
      <form id="metaForm">
        <label>Title</label><input name="title" value="${esc(quiz.title)}" required>
        <label>Topic</label><input name="topic" value="${esc(quiz.topic)}">
        <label>Difficulty</label><select name="difficulty">${['easy', 'easy_medium', 'medium', 'hard', 'expert'].map(d =>
          `<option value="${d}" ${quiz.difficulty === d ? 'selected' : ''}>${d.replace('_', '\u2013')}</option>`).join('')}</select>
        <label>Time limit in minutes (empty = untimed)</label><input name="minutes" type="number" min="1" value="${quiz.time_limit_seconds ? Math.round(quiz.time_limit_seconds / 60) : ''}">
        <label class="row" style="gap:8px"><input type="checkbox" name="published" style="width:auto" ${quiz.is_published ? 'checked' : ''}> Published</label>
        <div style="margin-top:12px"><button class="btn secondary">Save settings</button></div>
      </form></div>
    <div class="card"><h2>Questions (${questions.length})</h2>
      <table><thead><tr><th>#</th><th>Question</th><th>Correct</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${questions.map(qq => `<tr>
        <td>${qq.position}</td>
        <td>${esc(qq.question_text.slice(0, 60))}${qq.question_text.length > 60 ? '\u2026' : ''}</td>
        <td><b>${qq.correct_choice.toUpperCase()}</b></td>
        <td>${qq.hidden ? '<span class="badge diff-medium">Hidden</span>' : '<span class="badge diff-easy">Active</span>'}</td>
        <td class="row" style="gap:6px">
          <button class="btn small quiet" data-qedit="${qq.id}">Edit</button>
          <button class="btn small quiet" data-qhide="${qq.id}">${qq.hidden ? 'Show' : 'Hide'}</button>
          <button class="btn small danger" data-qdel="${qq.id}">Delete</button>
        </td></tr>`).join('')}</tbody></table>
      <div style="margin-top:12px"><button class="btn" id="addQBtn">+ Add question</button></div>
      <div id="qForm"></div>
    </div>
    <div class="card"><h2>CSV import</h2>
      <p class="muted small">Header row required: question,choice_a,choice_b,choice_c,choice_d,correct (A/B/C/D), optional position. Max 500 rows, 5 MB. Nothing is saved until you confirm the preview.</p>
      <input type="file" id="csvFile" accept=".csv">
      <div style="margin-top:12px"><button class="btn secondary" id="previewBtn">Preview import</button></div>
      <div id="csvPreview"></div></div>`;

  document.getElementById('metaForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const minutes = f.get('minutes');
    try {
      await api(`/api/admin/quizzes/${quizId}`, { method: 'PATCH', body: {
        title: f.get('title'), topic: f.get('topic'), difficulty: f.get('difficulty'),
        time_limit_seconds: minutes ? +minutes * 60 : null,
        is_published: f.get('published') === 'on' }});
      toast('Quiz settings saved'); adminQuizEditor(quizId);
    } catch (err) { toast(err.message); }
  };

  const qFormDiv = document.getElementById('qForm');
  function renderQForm(existing) {
    const v = existing || { question_text: '', choice_a: '', choice_b: '', choice_c: '', choice_d: '', correct_choice: '', position: '' };
    qFormDiv.innerHTML = `<div class="card" style="border:2px solid var(--accent)"><h2>${existing ? 'Editing question' : 'Add question'}</h2>
      <form id="qFormInner">
        <label>Question text <span class="muted small">(3\u2013500 chars)</span></label>
        <textarea name="question_text" rows="4" maxlength="500" required>${esc(v.question_text)}</textarea>
        ${['a', 'b', 'c', 'd'].map(c => `
          <label class="row" style="margin-bottom:4px"><span class="letter" style="width:26px;height:26px;border-radius:50%;background:var(--bg);display:inline-flex;align-items:center;justify-content:center;font-weight:800">${c.toUpperCase()}</span>
          <input name="choice_${c}" value="${esc(v['choice_' + c])}" maxlength="200" required style="flex:1">
          <label class="row small" style="margin:0"><input type="radio" name="correct" value="${c}" style="width:auto" ${v.correct_choice === c ? 'checked' : ''}> correct</label></label>`).join('')}
        <label>Position (optional)</label><input name="position" type="number" min="1" value="${v.position || ''}">
        <div style="margin-top:12px"><button class="btn">${existing ? 'Update question' : 'Save question'}</button>
        <button type="button" class="btn quiet" id="qCancel">Cancel</button></div>
      </form></div>`;
    document.getElementById('qCancel').onclick = () => { qFormDiv.innerHTML = ''; };
    document.getElementById('qFormInner').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const correct = f.get('correct');
      if (!correct) { toast('Select which choice is the correct answer'); return; }
      const body = {
        question_text: f.get('question_text'),
        choice_a: f.get('choice_a'), choice_b: f.get('choice_b'),
        choice_c: f.get('choice_c'), choice_d: f.get('choice_d'),
        correct_choice: correct, position: f.get('position') || undefined,
      };
      try {
        if (existing) await api(`/api/admin/questions/${existing.id}`, { method: 'PATCH', body });
        else await api(`/api/admin/quizzes/${quizId}/questions`, { method: 'POST', body });
        toast(existing ? 'Question updated' : 'Question added');
        adminQuizEditor(quizId);
      } catch (err) { toast(err.message); }
    };
  }
  document.getElementById('addQBtn').onclick = () => renderQForm(null);
  document.querySelectorAll('[data-qedit]').forEach(b => b.onclick = () =>
    renderQForm(questions.find(x => x.id == b.dataset.qedit)));
  document.querySelectorAll('[data-qhide]').forEach(b => b.onclick = async () => {
    const qq = questions.find(x => x.id == b.dataset.qhide);
    await api(`/api/admin/questions/${qq.id}`, { method: 'PATCH', body: { hidden: !qq.hidden } });
    toast(qq.hidden ? 'Question shown' : 'Question hidden'); adminQuizEditor(quizId);
  });
  document.querySelectorAll('[data-qdel]').forEach(b => b.onclick = async () => {
    const qq = questions.find(x => x.id == b.dataset.qdel);
    if (!confirm(`Delete "${qq.question_text.slice(0, 50)}"?\n\nIf it has attempt history it will be hidden instead (recommended), so past scores stay valid. Click OK to proceed.`)) return;
    try {
      const res = await api(`/api/admin/questions/${qq.id}?force=1`, { method: 'DELETE' });
      toast(res.hidden ? 'Hidden instead of deleted (has history)' : 'Question deleted');
      adminQuizEditor(quizId);
    } catch (err) { toast(err.message); }
  });

  // CSV import flow
  let pendingImport = null;
  document.getElementById('previewBtn').onclick = async () => {
    const fileInput = document.getElementById('csvFile');
    if (!fileInput.files.length) { toast('Choose a .csv file first'); return; }
    const csv = await fileInput.files[0].text();
    try {
      const result = await api(`/api/admin/quizzes/${quizId}/import/preview`, { method: 'POST', body: { csv } });
      pendingImport = result;
      const dv = document.getElementById('csvPreview');
      if (result.fatal) { dv.innerHTML = `<div class="alert error">${esc(result.fatal)}</div>`; return; }
      dv.innerHTML = `
        <div class="alert ${result.summary.errors ? 'error' : 'ok'}">
          ${result.summary.valid} valid \u00b7 ${result.summary.skipped} duplicates skipped \u00b7 ${result.summary.errors} errors
        </div>
        ${result.errors.length ? `<div class="alert error" style="max-height:180px;overflow:auto">${result.errors.map(e =>
          `Row ${e.rowNumber}: ${esc(e.reason)}`).join('<br>')}</div>` : ''}
        ${result.preview.length ? `<table><thead><tr><th>Row</th><th>Question</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Correct</th></tr></thead>
        <tbody>${result.preview.map(r => `<tr><td>${r.rowNumber}</td><td>${esc(r.question_text.slice(0, 60))}</td>
          <td class="small">${esc(r.choice_a)}</td><td class="small">${esc(r.choice_b)}</td>
          <td class="small">${esc(r.choice_c)}</td><td class="small">${esc(r.choice_d)}</td>
          <td><b class="badge diff-easy">${r.correct_choice.toUpperCase()}</b></td></tr>`).join('')}</tbody></table>` : ''}
        <div class="row" style="margin-top:12px">
          <button class="btn" id="commitBtn" ${!result.summary.valid ? 'disabled' : ''}>Import ${result.summary.valid} questions</button>
          <button class="btn quiet" id="csvCancel">Cancel</button>
        </div>`;
      const cc = document.getElementById('commitBtn');
      if (cc) cc.onclick = async () => {
        try {
          const res = await api(`/api/admin/quizzes/${quizId}/import/commit`, { method: 'POST', body: { rows: result.valid } });
          toast(`${res.imported} questions added, ${result.summary.skipped} skipped`);
          adminQuizEditor(quizId);
        } catch (err) { toast(err.message); }
      };
      document.getElementById('csvCancel').onclick = () => { pendingImport = null; dv.innerHTML = ''; };
    } catch (err) { toast(err.message); }
  };
}

async function adminUsers() {
  const { users } = await api('/api/admin/users');
  $app.innerHTML = `<h1>Users</h1><div id="drill"></div>
    <div class="card">
    <p class="muted small">You can promote/demote admins and disable accounts. You cannot change your own role or disable yourself, and passwords can only be changed by each user.</p>
    <table><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Attempts</th><th>Joined</th><th>Actions</th></tr></thead>
    <tbody>${users.map(u => `<tr class="${u.id === me.id ? 'me' : ''}">
      <td><b>${esc(u.username)}</b>${u.id === me.id ? ' (you)' : ''}</td>
      <td class="small">${esc(u.email)}</td>
      <td><span class="badge ${u.role === 'admin' ? 'diff-medium' : 'diff-easy'}">${u.role}</span></td>
      <td>${u.disabled ? '<span class="badge diff-expert">Disabled</span>' : '<span class="badge diff-easy">Active</span>'}</td>
      <td>${u.total_completed}</td>
      <td class="small">${fmtDate(u.joined_at)}</td>
      <td class="row" style="gap:6px">
        <button class="btn small quiet" data-view="${u.id}">History</button>
        ${u.id !== me.id ? `<button class="btn small quiet" data-role="${u.id}">${u.role === 'admin' ? 'Revoke admin' : 'Make admin'}</button>
        <button class="btn small quiet" data-dis="${u.id}">${u.disabled ? 'Re-enable' : 'Disable'}</button>` : ''}
      </td></tr>`).join('')}</tbody></table></div>`;
  const drill = document.getElementById('drill');
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = async () => {
    const { attempts } = await api(`/api/admin/users/${b.dataset.view}/attempts`);
    const u = users.find(x => x.id == b.dataset.view);
    drill.innerHTML = `<div class="card"><h2>${esc(u.username)} \u2014 completed attempts</h2>
      ${attempts.length ? `<table><thead><tr><th>Quiz</th><th>Score</th><th>%</th><th>Finished</th></tr></thead>
      <tbody>${attempts.map(a => `<tr><td>${esc(a.quiz_title)}</td><td>${a.points}/${a.total_questions}</td>
        <td>${pct(a.points, a.total_questions)}</td><td class="small">${fmtDate(a.finished_at)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No completed attempts.</p>'}</div>`;
    drill.scrollIntoView({ behavior: 'smooth' });
  });
  document.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => {
    const u = users.find(x => x.id == b.dataset.role);
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { role: u.role === 'admin' ? 'player' : 'admin' } });
      toast('Role updated'); adminUsers();
    } catch (err) { toast(err.message); }
  });
  document.querySelectorAll('[data-dis]').forEach(b => b.onclick = async () => {
    const u = users.find(x => x.id == b.dataset.dis);
    if (!confirm(u.disabled ? `Re-enable ${u.username}?` : `Disable ${u.username}? They will not be able to log in or start attempts.`)) return;
    await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } });
    toast('Account updated'); adminUsers();
  });
}

async function adminStats() {
  const s = await api('/api/admin/stats');
  const o = s.overview || {};
  const maxDay = Math.max(1, ...s.perDay.map(d => +d.attempts));
  const maxMiss = Math.max(1, ...s.worst.map(w => +w.miss_rate));
  $app.innerHTML = `<h1>Analytics</h1>
    <div class="grid cols2">
      <div class="card stat"><b>${o.total_users ?? 0}</b><span class="muted">Total users</span></div>
      <div class="card stat"><b>${o.attempts_today ?? 0}</b><span class="muted">Attempts today</span></div>
      <div class="card stat"><b>${o.attempts_total ?? 0}</b><span class="muted">Completed attempts</span></div>
      <div class="card stat"><b>${o.avg_score_pct ?? 0}%</b><span class="muted">Average score</span></div>
    </div>
    <div class="card"><h2>Attempts per day (last 30 days)</h2>
      ${s.perDay.length ? s.perDay.map(d => `<div class="row small" style="margin:4px 0"><span style="width:90px" class="muted">${new Date(d.day).toLocaleDateString()}</span>
        <div class="bar" style="flex:1"><div style="width:${100 * d.attempts / maxDay}%"></div></div><b>${d.attempts}</b></div>`).join('')
        : '<p class="muted">No attempts in this period.</p>'}</div>
    <div class="card"><h2>Top 10 most-missed questions</h2>
      ${s.worst.length ? s.worst.map(w => `<div class="row small" style="margin:4px 0"><span style="flex:1">${esc(w.question)}</span>
        <div class="bar" style="flex:1"><div style="width:${100 * w.miss_rate / maxMiss}%;background:var(--expert)"></div></div>
        <b>${w.miss_rate}% missed</b><span class="muted">(${w.times_answered} answers)</span></div>`).join('')
        : '<p class="muted">No answers recorded yet.</p>'}</div>
    <div class="card"><h2>Per quiz</h2>
      <table><thead><tr><th>Quiz</th><th>Attempts</th><th>Avg %</th></tr></thead>
      <tbody>${s.perQuiz.map(q => `<tr><td>${esc(q.title)}</td><td>${q.attempts}</td><td>${q.avg_pct ?? '\u2014'}%</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- public question route note ----------
// The play view fetches questions via /api/quizzes/:id/questions (added on the server).

// ---------- router ----------
async function route() {
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/');
  renderNav();
  try {
    if (!me && !['login', 'register'].includes(parts[0])) await refreshMe();
    if (parts[0] === '' || parts[0] === undefined) { me ? await dashboard() : landing(); }
    else if (parts[0] === 'login') { me ? go('#/') : loginView(); }
    else if (parts[0] === 'register') { me ? go('#/') : registerView(); }
    else if (parts[0] === 'quizzes') { await quizList(); }
    else if (parts[0] === 'play' && parts[1]) { await startPlay(parts[1]); }
    else if (parts[0] === 'results' && parts[1]) { await resultsView(parts[1]); }
    else if (parts[0] === 'history') { await historyView(); }
    else if (parts[0] === 'leaderboard') { await leaderboardView(parts[1]); }
    else if (parts[0] === 'profile') { profileView(); }
    else if (parts[0] === 'admin') {
      if (!me || me.role !== 'admin') { $app.innerHTML = '<div class="card">Admin access required.</div>'; return; }
      if (!parts[1]) adminHome();
      else if (parts[1] === 'quizzes') await adminQuizzes();
      else if (parts[1] === 'quiz-new') quizMetaForm();
      else if (parts[1] === 'quiz' && parts[2]) await adminQuizEditor(parts[2]);
      else if (parts[1] === 'users') await adminUsers();
      else if (parts[1] === 'stats') await adminStats();
    }
    else $app.innerHTML = '<div class="card">Page not found. <a href="#/">Home</a></div>';
  } catch (err) {
    if (err.status === 401) { me = null; renderNav(); loginView(); }
    else $app.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
route();
