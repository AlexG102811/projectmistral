# Quiz App

A quiz web app for a high school AI-assisted web development project. Five general-knowledge quizzes (easy \u2192 expert), player accounts, attempt history, leaderboards, timed quiz mode, per-question analytics, and an admin area with a question editor and CSV import.

**Stack:** plain HTML/CSS/JavaScript \u00b7 Node.js 24 LTS + Express 5 \u00b7 PostgreSQL (Replit) via `pg` with parameterized SQL \u00b7 `express-session` signed cookies \u00b7 `node:crypto` scrypt password hashing (no plain-text passwords).

## Setup on Replit

1. Import this repo into a Replit (Node.js template).
2. Replit automatically provisions a PostgreSQL database and exposes `DATABASE_URL`.
3. Secrets to set (Replit \u2192 Tools \u2192 Secrets):
   - `SESSION_SECRET` \u2014 any long random string
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` \u2014 first admin account (created by the seed script)
4. In the Shell:
   ```bash
   npm install
   npm run seed     # creates tables, 5 quizzes + 50 questions, first admin
   npm run start    # serves the app (Replit web port 3000)
   ```
5. The Replit workspace is the **QA environment**; use Replit Deployment for production with its own production database. Run `npm install && npm run seed` there once, with production secrets.

## Feature map (spec)

| Area | Where |
|---|---|
| Auth (register/login/logout, hashed passwords) | `server.js` `/api/auth/*`, scrypt helpers |
| 5 quizzes \u00d7 10 questions, 4 choices, 1 correct | `seed.js` |
| Play, score, percentage, retry | `public/app.js` play/results views, `/api/attempts/*` |
| Player/admin roles | `users.role`, `requireAdmin` middleware; admin bootstrap via `seed.js` |
| Attempt history (user, quiz, score, question count, date/time) | `GET /api/me/attempts` |
| Overall leaderboard (completed attempts) | `GET /api/leaderboard/overall` (spec 6.2) |
| Per-quiz leaderboard (best score, attempts, ties) | `GET /api/leaderboard/quizzes/:id` (spec 6.3) |
| Unfinished attempts never count | status `in_progress`/`abandoned` excluded from all boards (6.5) |
| Usernames, not emails, on boards | all leaderboard queries select `u.username` |
| Admin question editor (CRUD, hide vs delete) | `/api/admin/questions/*`, Admin \u2192 Quizzes |
| CSV upload with preview + validation | `csv-import.js`, Admin \u2192 quiz \u2192 CSV import (spec 8) |
| Timed quiz mode (server-verified, +10s grace) | finish/patch logic in `server.js` (spec 6.7) |
| Per-question analytics (miss rates, trends) | `GET /api/admin/stats`, Admin \u2192 Analytics (spec 7) |

## Extra features (beyond shared requirements)

1. **Timed quiz mode** \u2014 per-quiz time limit set by admin; server computes elapsed time from `started_at`; late answers rejected; expired attempts complete with the answers received (spec 6.7).
2. **Per-question analytics** \u2014 miss-rate leaderboard, attempts-per-day trend, score distribution, per-quiz averages (spec 7).

## CSV template

```csv
question,choice_a,choice_b,choice_c,choice_d,correct,position
What is 2+2?,1,3,4,5,C,1
```

See `templates/question-template.csv`. Headers are case- and order-insensitive; `position` is optional; max 500 rows / 5 MB; nothing is imported until the admin confirms the preview.

## Notes

- Deviation from spec 8.5: the CSV upload is sent as JSON text read in the browser (no multipart dependency); the server still parses and validates everything server-side and revalidates at commit.
- Sessions are stored in memory by default, which resets on restart; wire a `pg` or `connect-pg-simple` session store in production if needed.
