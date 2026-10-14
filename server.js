// server.js — Quiz App server: static files + API routes (Express 5, Node 24)
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { pool, initSchema } = require('./db');
const { parseCsv, validateRows } = require('./csv-import');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '6mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!process.env.FORCE_SECURE_COOKIES,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7-day sliding session
  },
}));

// ---------- helpers ----------
const CHOICES = ['a', 'b', 'c', 'd'];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, joined_at: u.joined_at };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
function wrap(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

// ---------- auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || username.length < 3 || username.length > 30) return res.status(400).json({ error: 'Username must be 3-30 characters' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const dupe = await pool.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1) OR email=$2', [username, email]);
  if (dupe.rows.length) return res.status(409).json({ error: 'Username or email already registered' });
  // Registration always creates a player (spec §4); admins come from the seed script only.
  const { rows } = await pool.query(
    'INSERT INTO users (username,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING *',
    [username, email, hashPassword(password), 'player']);
  req.session.userId = rows[0].id;
  req.session.role = rows[0].role;
  res.json({ user: publicUser(rows[0]) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const name = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) OR email=$2', [name, name.toLowerCase()]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
  if (user.disabled) return res.status(403).json({ error: 'This account has been disabled' });
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.userId]);
  res.json({ user: publicUser(rows[0]) });
}));

// Update profile / password
app.patch('/api/me', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const { currentPassword, newPassword } = req.body;
  if (newPassword) {
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [uid]);
    if (!verifyPassword(String(currentPassword || ''), rows[0].password_hash))
      return res.status(403).json({ error: 'Current password is incorrect' });
    if (String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(String(newPassword)), uid]);
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [uid]);
  res.json({ user: publicUser(rows[0]) });
}));

// Self-service account deletion (A-3): removes user + entries from all boards.
app.delete('/api/me', requireAuth, wrap(async (req, res) => {
  await pool.query('DELETE FROM answer_events WHERE user_id=$1', [req.session.userId]);
  await pool.query('DELETE FROM attempts WHERE user_id=$1', [req.session.userId]);
  await pool.query('DELETE FROM users WHERE id=$1', [req.session.userId]);
  req.session.destroy(() => res.json({ ok: true }));
}));

// ---------- quizzes ----------
app.get('/api/quizzes', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.id, q.title, q.topic, q.difficulty, q.time_limit_seconds,
           (SELECT COUNT(*) FROM questions x WHERE x.quiz_id=q.id AND x.hidden=FALSE) AS question_count,
           EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=$1 AND a.quiz_id=q.id AND a.status='in_progress') AS has_in_progress,
           EXISTS (SELECT 1 FROM attempts a WHERE a.user_id=$1 AND a.quiz_id=q.id AND a.status='abandoned') AS has_abandoned
    FROM quizzes q WHERE q.is_published=TRUE ORDER BY q.id`, [req.session.userId]);
  res.json({ quizzes: rows.map(r => ({ ...r, question_count: +r.question_count })) });
}));

app.get('/api/quizzes/:id', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id,title,topic,difficulty,time_limit_seconds FROM quizzes WHERE id=$1 AND is_published=TRUE`,
    [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Quiz not found' });
  const qc = await pool.query('SELECT COUNT(*) AS n FROM questions WHERE quiz_id=$1 AND hidden=FALSE', [req.params.id]);
  res.json({ quiz: { ...rows[0], question_count: +qc.rows[0].n } });
}));

// ---------- attempts ----------
async function loadAttempt(req, res) {
  const { rows } = await pool.query('SELECT * FROM attempts WHERE id=$1', [req.params.id]);
  const attempt = rows[0];
  if (!attempt) { res.status(404).json({ error: 'Attempt not found' }); return null; }
  if (attempt.user_id !== req.session.userId) { res.status(403).json({ error: 'Not your attempt' }); return null; }
  return attempt;
}

function quizDeadline(quiz, attempt) {
  if (!quiz.time_limit_seconds) return null;
  return new Date(attempt.started_at.getTime() + quiz.time_limit_seconds * 1000 + 10000); // +10s grace (T-4)
}

// Questions for a player's current attempt: returns only the snapshot questions,
// without correct answers (players must not see which choice is right).
app.get('/api/quizzes/:id/questions', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const att = await pool.query(
    `SELECT * FROM attempts WHERE user_id=$1 AND quiz_id=$2 AND status='in_progress' ORDER BY id DESC LIMIT 1`,
    [uid, req.params.id]);
  if (!att.rows.length) return res.status(400).json({ error: 'No in-progress attempt for this quiz' });
  const snapshot = att.rows[0].question_snapshot || [];
  const { rows } = await pool.query(
    `SELECT id, position, question_text, choice_a, choice_b, choice_c, choice_d
     FROM questions WHERE id = ANY($1::int[]) ORDER BY position, id`, [snapshot]);
  res.json({ attempt: att.rows[0], questions: rows });
}));

// Saved answers for resume (no correct answers leaked)
app.get('/api/attempts/:id/answers', requireAuth, wrap(async (req, res) => {
  const attempt = await loadAttempt(req, res); if (!attempt) return;
  const { rows } = await pool.query(
    `SELECT question_id, chosen_choice FROM answer_events WHERE attempt_id=$1`, [attempt.id]);
  res.json({ answers: rows });
}));

// Start attempt -> snapshot
app.post('/api/quizzes/:id/attempts', requireAuth, wrap(async (req, res) => {
  const uid = req.session.userId;
  const u = await pool.query('SELECT disabled, role FROM users WHERE id=$1', [uid]);
  if (u.rows[0].disabled) return res.status(403).json({ error: 'Account disabled' });
  const qz = await pool.query('SELECT * FROM quizzes WHERE id=$1 AND is_published=TRUE', [req.params.id]);
  if (!qz.rows.length) return res.status(404).json({ error: 'Quiz not found' });
  // resume existing in-progress attempt if any (U-2)
  const existing = await pool.query(
    `SELECT * FROM attempts WHERE user_id=$1 AND quiz_id=$2 AND status='in_progress' ORDER BY id DESC LIMIT 1`,
    [uid, req.params.id]);
  if (existing.rows.length) {
    const quiz = qz.rows[0];
    return res.json({ attempt: existing.rows[0], resumed: true, deadline: quizDeadline(quiz, existing.rows[0]) });
  }
  const qs = await pool.query(
    'SELECT id FROM questions WHERE quiz_id=$1 AND hidden=FALSE ORDER BY position, id', [req.params.id]);
  const ids = qs.rows.map(r => r.id);
  if (!ids.length) return res.status(400).json({ error: 'Quiz has no questions' });
  const { rows } = await pool.query(
    `INSERT INTO attempts (user_id,quiz_id,status,total_questions,question_snapshot)
     VALUES ($1,$2,'in_progress',$3,$4) RETURNING *`,
    [uid, req.params.id, ids.length, ids]);
  res.json({ attempt: rows[0], resumed: false, deadline: quizDeadline(qz.rows[0], rows[0]) });
}));

// Save answers / resume (server rejects saves after the deadline, T-5)
app.patch('/api/attempts/:id', requireAuth, wrap(async (req, res) => {
  const attempt = await loadAttempt(req, res); if (!attempt) return;
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'Attempt already finished' });
  const quiz = (await pool.query('SELECT * FROM quizzes WHERE id=$1', [attempt.quiz_id])).rows[0];
  const deadline = quizDeadline(quiz, attempt);
  if (deadline && Date.now() > deadline.getTime())
    return res.status(410).json({ error: 'Time is up for this attempt', expired: true });

  const answers = req.body.answers || [];
  const inSnapshot = attempt.question_snapshot || [];
  for (const a of answers) {
    if (!CHOICES.includes(a.chosen)) continue;
    if (!inSnapshot.includes(a.question_id)) continue;
    const correct = (await pool.query('SELECT correct_choice FROM questions WHERE id=$1', [a.question_id])).rows[0];
    if (!correct) continue;
    const isCorrect = correct.correct_choice === a.chosen;
    // one row per (attempt, question): replace any previously saved answer
    await pool.query('DELETE FROM answer_events WHERE attempt_id=$1 AND question_id=$2', [attempt.id, a.question_id]);
    await pool.query(
      `INSERT INTO answer_events (attempt_id,user_id,question_id,chosen_choice,is_correct,ms_taken)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [attempt.id, req.session.userId, a.question_id, a.chosen, isCorrect, Math.max(0, Math.min(600000, +a.ms_taken || 0))]);
  }
  const saved = await pool.query(
    `SELECT question_id, chosen_choice FROM answer_events WHERE attempt_id=$1`, [attempt.id]);
  res.json({ ok: true, saved: saved.rows });
}));

// Finish: server computes points; elapsed > limit+grace => answers so far, rest 0 (T-4/T-5)
app.post('/api/attempts/:id/finish', requireAuth, wrap(async (req, res) => {
  const attempt = await loadAttempt(req, res); if (!attempt) return;
  if (attempt.status !== 'in_progress') return res.status(400).json({ error: 'Attempt already finished' });
  const quiz = (await pool.query('SELECT * FROM quizzes WHERE id=$1', [attempt.quiz_id])).rows[0];
  const deadline = quizDeadline(quiz, attempt);
  const expired = !!(deadline && Date.now() > deadline.getTime());
  const { rows } = await pool.query(
    `UPDATE attempts SET status='completed', points=COALESCE(
       (SELECT COUNT(*) FROM answer_events e WHERE e.attempt_id=$1 AND e.is_correct), 0),
       finished_at=now()
     WHERE id=$1 AND status='in_progress' RETURNING *`, [attempt.id]);
  res.json({ attempt: rows[0], expired });
}));

app.post('/api/attempts/:id/abandon', requireAuth, wrap(async (req, res) => {
  const attempt = await loadAttempt(req, res); if (!attempt) return;
  await pool.query(`UPDATE attempts SET status='abandoned', finished_at=now() WHERE id=$1 AND status='in_progress'`, [attempt.id]);
  res.json({ ok: true });
}));

app.get('/api/attempts/:id/results', requireAuth, wrap(async (req, res) => {
  const attempt = await loadAttempt(req, res); if (!attempt) return;
  const events = await pool.query(
    `SELECT e.question_id, e.chosen_choice, e.is_correct, q.question_text,
            q.choice_a,q.choice_b,q.choice_c,q.choice_d,q.correct_choice
     FROM answer_events e JOIN questions q ON q.id=e.question_id
     WHERE e.attempt_id=$1`, [attempt.id]);
  res.json({ attempt, breakdown: events.rows });
}));

// History
app.get('/api/me/attempts', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.quiz_id, a.status, a.points, a.total_questions, a.started_at, a.finished_at,
            q.title AS quiz_title, q.difficulty,
            (a.finished_at - a.started_at) AS elapsed
     FROM attempts a JOIN quizzes q ON q.id=a.quiz_id
     WHERE a.user_id=$1 AND a.status='completed'
     ORDER BY a.finished_at DESC LIMIT 200`, [req.session.userId]);
  res.json({ attempts: rows });
}));

// ---------- leaderboards (spec §6) ----------
app.get('/api/leaderboard/overall', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, COUNT(a.id) AS total_attempts,
           COUNT(DISTINCT a.quiz_id) AS quizzes_played, MIN(a.finished_at) AS first_at, u.joined_at
    FROM users u
    JOIN attempts a ON a.user_id = u.id AND a.status = 'completed'
    GROUP BY u.id, u.username, u.joined_at
    ORDER BY total_attempts DESC, u.username ASC LIMIT 100`);
  res.json({ leaderboard: rows });
}));

app.get('/api/leaderboard/quizzes/:id', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(`
    WITH best AS (
      SELECT DISTINCT ON (user_id) user_id, points, finished_at AS best_achieved_at
      FROM attempts
      WHERE quiz_id = $1 AND status = 'completed'
      ORDER BY user_id, points DESC, finished_at ASC
    )
    SELECT u.id, u.username, b.points AS best_points, b.best_achieved_at,
           COUNT(a.id) AS attempts
    FROM best b
    JOIN users u ON u.id = b.user_id
    LEFT JOIN attempts a ON a.user_id = b.user_id AND a.quiz_id = $1 AND a.status = 'completed'
    GROUP BY u.id, u.username, b.points, b.best_achieved_at
    ORDER BY b.points DESC, b.best_achieved_at ASC, COUNT(a.id) ASC, u.username ASC LIMIT 100`,
    [req.params.id]);
  res.json({ leaderboard: rows });
}));

// ---------- admin: quizzes & questions ----------
app.get('/api/admin/quizzes', requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT q.*, (SELECT COUNT(*) FROM questions x WHERE x.quiz_id=q.id AND x.hidden=FALSE) AS question_count,
           (SELECT COUNT(*) FROM attempts a WHERE a.quiz_id=q.id AND a.status='completed') AS attempt_count
    FROM quizzes q ORDER BY q.id`);
  res.json({ quizzes: rows.map(r => ({ ...r, question_count: +r.question_count, attempt_count: +r.attempt_count })) });
}));

app.post('/api/admin/quizzes', requireAdmin, wrap(async (req, res) => {
  const { title, topic, difficulty, time_limit_seconds, is_published } = req.body;
  if (!String(title || '').trim()) return res.status(400).json({ error: 'Title required' });
  const { rows } = await pool.query(
    `INSERT INTO quizzes (title,topic,difficulty,time_limit_seconds,is_published)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [String(title).trim(), String(topic || '').trim(),
     ['easy','easy_medium','medium','hard','expert'].includes(difficulty) ? difficulty : 'easy',
     time_limit_seconds ? Math.max(30, +time_limit_seconds) : null,
     is_published !== false]);
  res.json({ quiz: rows[0] });
}));

app.patch('/api/admin/quizzes/:id', requireAdmin, wrap(async (req, res) => {
  const q = await pool.query('SELECT * FROM quizzes WHERE id=$1', [req.params.id]);
  if (!q.rows.length) return res.status(404).json({ error: 'Quiz not found' });
  const cur = q.rows[0];
  const b = req.body;
  const title = b.title !== undefined ? String(b.title).trim() : cur.title;
  const topic = b.topic !== undefined ? String(b.topic).trim() : cur.topic;
  const difficulty = ['easy','easy_medium','medium','hard','expert'].includes(b.difficulty) ? b.difficulty : cur.difficulty;
  const tls = b.time_limit_seconds !== undefined ? (b.time_limit_seconds ? Math.max(30, +b.time_limit_seconds) : null) : cur.time_limit_seconds;
  const is_published = b.is_published !== undefined ? !!b.is_published : cur.is_published;
  const { rows } = await pool.query(
    `UPDATE quizzes SET title=$1,topic=$2,difficulty=$3,time_limit_seconds=$4,is_published=$5 WHERE id=$6 RETURNING *`,
    [title, topic, difficulty, tls, is_published, req.params.id]);
  res.json({ quiz: rows[0] });
}));

app.get('/api/admin/quizzes/:id/questions', requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM questions WHERE quiz_id=$1 ORDER BY position, id`, [req.params.id]);
  res.json({ questions: rows });
}));

function validateQuestionBody(b) {
  const text = String(b.question_text || '').trim();
  const choices = CHOICES.map(c => String(b['choice_' + c] || '').trim());
  if (text.length < 3 || text.length > 500) return 'Question text must be 3-500 characters';
  for (const c of choices) if (c.length < 1 || c.length > 200) return 'Each choice must be 1-200 characters';
  const lower = choices.map(c => c.toLowerCase());
  if (new Set(lower).size !== 4) return 'Choices must be different from each other';
  if (!CHOICES.includes(String(b.correct_choice || '').toLowerCase())) return 'Correct answer must be A, B, C, or D';
  return null;
}

app.post('/api/admin/quizzes/:id/questions', requireAdmin, wrap(async (req, res) => {
  const err = validateQuestionBody(req.body); if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const pos = await pool.query(
    'SELECT COALESCE(MAX(position),0)+1 AS next FROM questions WHERE quiz_id=$1', [req.params.id]);
  const position = b.position ? Math.max(1, +b.position) : +pos.rows[0].next;
  const { rows } = await pool.query(
    `INSERT INTO questions (quiz_id,question_text,choice_a,choice_b,choice_c,choice_d,correct_choice,position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.params.id, b.question_text.trim(), ...CHOICES.map(c => b['choice_' + c].trim()),
     String(b.correct_choice).toLowerCase(), position]);
  res.json({ question: rows[0] });
}));

app.patch('/api/admin/questions/:id', requireAdmin, wrap(async (req, res) => {
  const existing = await pool.query('SELECT * FROM questions WHERE id=$1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Question not found' });
  const cur = existing.rows[0];
  const b = req.body;
  const merged = {
    question_text: b.question_text !== undefined ? b.question_text : cur.question_text,
    choice_a: b.choice_a !== undefined ? b.choice_a : cur.choice_a,
    choice_b: b.choice_b !== undefined ? b.choice_b : cur.choice_b,
    choice_c: b.choice_c !== undefined ? b.choice_c : cur.choice_c,
    choice_d: b.choice_d !== undefined ? b.choice_d : cur.choice_d,
    correct_choice: b.correct_choice !== undefined ? b.correct_choice : cur.correct_choice,
  };
  const err = validateQuestionBody(merged); if (err) return res.status(400).json({ error: err });
  const hidden = b.hidden !== undefined ? !!b.hidden : cur.hidden;
  const position = b.position ? Math.max(1, +b.position) : cur.position;
  const { rows } = await pool.query(
    `UPDATE questions SET question_text=$1,choice_a=$2,choice_b=$3,choice_c=$4,choice_d=$5,correct_choice=$6,hidden=$7,position=$8
     WHERE id=$9 RETURNING *`,
    [merged.question_text.trim(), ...CHOICES.map(c => merged['choice_' + c].trim()),
     String(merged.correct_choice).toLowerCase(), hidden, position, req.params.id]);
  res.json({ question: rows[0] });
}));

// delete vs hide: with history, hide unless ?force=1 (spec §9.4)
app.delete('/api/admin/questions/:id', requireAdmin, wrap(async (req, res) => {
  const used = await pool.query('SELECT COUNT(*) AS n FROM answer_events WHERE question_id=$1', [req.params.id]);
  const hasHistory = +used.rows[0].n > 0;
  if (hasHistory && req.query.force !== '1') {
    await pool.query('UPDATE questions SET hidden=TRUE WHERE id=$1', [req.params.id]);
    return res.json({ hidden: true, message: 'Question hidden (it has attempt history). Past scores are unchanged.' });
  }
  await pool.query('DELETE FROM answer_events WHERE question_id=$1', [req.params.id]);
  await pool.query('DELETE FROM questions WHERE id=$1', [req.params.id]);
  res.json({ deleted: true });
}));

// ---------- admin: CSV import (spec §8) ----------
app.post('/api/admin/quizzes/:id/import/preview', requireAdmin, wrap(async (req, res) => {
  const csvText = String(req.body.csv || '');
  if (Buffer.byteLength(csvText, 'utf8') > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5 MB)' });
  const parse = parseCsv(csvText);
  if (parse.fatal) return res.status(400).json({ error: parse.fatal });
  const result = await validateRows(pool, parse.rows, req.params.id);
  res.json(result);
}));

app.post('/api/admin/quizzes/:id/import/commit', requireAdmin, wrap(async (req, res) => {
  const rows = req.body.rows || [];
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows to import' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const startPos = (await client.query(
      'SELECT COALESCE(MAX(position),0)+1 AS next FROM questions WHERE quiz_id=$1', [req.params.id])).rows[0].next;
    let i = 0;
    for (const r of rows) {
      const err = validateQuestionBody(r); // server revalidates; never trusts the preview
      if (err) throw new Error('Row rejected on revalidation: ' + err);
      const pos = r.position ? Math.max(1, +r.position) : startPos + i;
      await client.query(
        `INSERT INTO questions (quiz_id,question_text,choice_a,choice_b,choice_c,choice_d,correct_choice,position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.params.id, r.question_text, r.choice_a, r.choice_b, r.choice_c, r.choice_d, String(r.correct_choice).toLowerCase(), pos]);
      i++;
    }
    await client.query('COMMIT');
    res.json({ imported: rows.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
}));

// ---------- admin: users ----------
app.get('/api/admin/users', requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.email, u.role, u.disabled, u.joined_at,
           COUNT(a.id) FILTER (WHERE a.status='completed') AS total_completed,
           COUNT(DISTINCT a.quiz_id) FILTER (WHERE a.status='completed') AS quizzes_played
    FROM users u LEFT JOIN attempts a ON a.user_id=u.id
    GROUP BY u.id ORDER BY u.joined_at ASC`);
  res.json({ users: rows });
}));

app.get('/api/admin/users/:id/attempts', requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.quiz_id, a.status, a.points, a.total_questions, a.started_at, a.finished_at, q.title AS quiz_title
     FROM attempts a JOIN quizzes q ON q.id=a.quiz_id
     WHERE a.user_id=$1 AND a.status='completed' ORDER BY a.finished_at DESC LIMIT 200`, [req.params.id]);
  res.json({ attempts: rows });
}));

app.patch('/api/admin/users/:id', requireAdmin, wrap(async (req, res) => {
  const target = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!target.rows.length) return res.status(404).json({ error: 'User not found' });
  if (req.params.id == req.session.userId) {
    // Self-protection (A-6): admin cannot demote or disable themselves.
    if (req.body.role !== undefined || req.body.disabled !== undefined)
      return res.status(400).json({ error: 'You cannot change your own role or disabled status' });
  }
  const role = req.body.role !== undefined ? (req.body.role === 'admin' ? 'admin' : 'player') : target.rows[0].role;
  const disabled = req.body.disabled !== undefined ? !!req.body.disabled : target.rows[0].disabled;
  const { rows } = await pool.query('UPDATE users SET role=$1, disabled=$2 WHERE id=$3 RETURNING id,username,email,role,disabled',
    [role, disabled, req.params.id]);
  res.json({ user: rows[0] });
}));

// ---------- admin: analytics (spec §7) ----------
app.get('/api/admin/stats', requireAdmin, wrap(async (req, res) => {
  const overview = (await pool.query(`
    SELECT (SELECT COUNT(*) FROM users) AS total_users,
           (SELECT COUNT(*) FROM attempts WHERE status='completed' AND finished_at::date = now()::date) AS attempts_today,
           (SELECT ROUND(AVG(100.0*points/NULLIF(total_questions,0)),1) FROM attempts WHERE status='completed') AS avg_score_pct,
           (SELECT COUNT(*) FROM attempts WHERE status='completed') AS attempts_total`)).rows[0];

  const perDay = (await pool.query(`
    SELECT finished_at::date AS day, COUNT(*) AS attempts
    FROM attempts WHERE status='completed' AND finished_at > now() - interval '30 days'
    GROUP BY day ORDER BY day`)).rows;

  const scoreDist = (await pool.query(`
    SELECT width_bucket(100.0*points/NULLIF(total_questions,0), 0, 100, 10) AS bucket, COUNT(*) AS n
    FROM attempts WHERE status='completed' GROUP BY bucket ORDER BY bucket`)).rows;

  const worst = (await pool.query(`
    SELECT q.id, LEFT(q.question_text, 60) AS question, q.quiz_id,
           COUNT(*) AS times_answered,
           ROUND(100.0 * SUM(CASE WHEN e.is_correct THEN 0 ELSE 1 END) / COUNT(*), 1) AS miss_rate
    FROM answer_events e JOIN questions q ON q.id=e.question_id
    GROUP BY q.id ORDER BY miss_rate DESC, times_answered DESC LIMIT 10`)).rows;

  const perQuiz = (await pool.query(`
    SELECT q.id, q.title, COUNT(a.id) AS attempts,
           ROUND(AVG(100.0*a.points/NULLIF(a.total_questions,0)),1) AS avg_pct
    FROM quizzes q LEFT JOIN attempts a ON a.quiz_id=q.id AND a.status='completed'
    GROUP BY q.id ORDER BY q.id`)).rows;

  res.json({ overview, perDay, scoreDist, worst, perQuiz });
}));

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- errors ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

initSchema().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Quiz app listening on port ${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
