# Online Examination and Evaluation System

A web app for running online exams and grading them, built with Node.js, Express, MongoDB, and a plain HTML/CSS/JS frontend (no framework, no build step). Teachers can create exams, add questions, grade student submissions in bulk, and pull real-time analytics + PDF reports. Students log in, take timed exams, and check their results once they're released.

I built this to mirror a resume line about an "online assessment management platform" — the focus areas were grading APIs that don't fall over when a teacher grades 100+ scripts at once, and reports that update live instead of needing a page refresh.

## What it does

- **Exams & questions** — teachers create exams and add questions: MCQ, multi-select, true/false, numeric, short answer, long answer. Objective ones get an answer key, subjective ones get a model answer + rubric for whoever grades them.
- **Taking an exam** — timed attempt, answers autosave as you go, and if your connection drops you can resume where you left off instead of losing everything.
- **Auto-grading** — MCQ/multi-select/true-false/numeric questions get scored the moment a student submits. No manual work needed there. Negative marking is optional and multi-select gets partial credit.
- **Bulk grading** — this is the main piece. Instead of opening one student's script at a time, a teacher picks a question and sees every student's answer to it in one list, types in marks for each, and saves the whole batch in a single request. Much faster than the usual one-by-one flow, and it still works if a couple of rows in the batch have bad data — those get reported back instead of failing the whole save.
- **Comments** — teachers can leave a note on a specific answer or on the whole submission.
- **Live analytics** — score distribution, which topics students are weak in, which questions are too easy/too hard, a leaderboard. It updates itself over Server-Sent Events as grading happens, so you don't need to hit refresh.
- **PDF exports** — a per-student report card, or a full class report, both generated with pdfkit. There's also a CSV of the marks sheet.
- **Roles** — student / teacher / admin, JWT-based auth.

## Stack

Plain HTML/CSS/JS on the frontend (ES modules, no bundler). Backend is Express on Node, MongoDB via Mongoose. JWT + bcrypt for auth. pdfkit for the PDF reports. Server-Sent Events for the live dashboard instead of websockets — didn't need bidirectional communication so SSE was simpler.

## Folder layout

```
server.js               entry point, connects to Mongo and starts express
src/
  app.js                express app + middleware wiring
  config/                env vars, db connection
  models/                User, Exam, Question, Submission
  controllers/           one file per resource (auth, exam, submission, grading, reports)
  routes/
  services/              auto-grader, analytics queries, pdf generation, event bus for SSE
  middleware/            auth check, error handler
  utils/
public/
  index.html             login page
  student.html / exam.html / result.html
  teacher.html / exam-builder.html / grading.html / analytics.html
  css/, js/              one js file per page
scripts/seed.js          fills the db with fake students/exams/submissions for testing
```

## Running it locally

Wasn't able to actually run/test this in the environment I built it in (no Node available), so treat the steps below as what *should* work rather than verified instructions. Worth a sanity check before you rely on it.

```bash
npm install
cp .env.example .env
```

Fill in `.env` — mainly `MONGO_URI` if you're not using a local MongoDB on the default port, and `JWT_SECRET` (required once `NODE_ENV=production`). Everything else has a reasonable default, check `.env.example` for the full list.

Optional but recommended — seed some fake data so the grading queue and dashboards aren't empty:

```bash
npm run seed
```

That creates a teacher, ~120 students, two exams with a mix of graded/pending submissions. All seeded accounts use the password `Password@123`:

- teacher@campus.edu
- admin@campus.edu
- student001@campus.edu (through ~student120)

Then:

```bash
npm run dev     # nodemon, restarts on file changes
npm start       # plain node
```

App runs on `http://localhost:4000` by default and serves both the API and the static frontend from the same origin.

## API, roughly

Everything's under `/api`, everything except `/auth/register` and `/auth/login` needs a bearer token (or the `token` cookie set on login).

- `POST /auth/login`, `POST /auth/register`, `GET /auth/me`
- `GET/POST /exams`, `GET/PATCH/DELETE /exams/:id`, plus nested `/exams/:id/questions`
- `POST /exams/:id/attempts` — start/resume an attempt
- `PATCH /submissions/:id/answers` — autosave one answer
- `POST /submissions/:id/submit` — final submit, triggers auto-grading
- `PATCH /grading/exams/:id/bulk` — the bulk grading endpoint
- `GET /grading/exams/:id/questions/:qid/queue` — pulls all responses to one question for the grading console
- `POST /grading/exams/:id/publish` — release results to students
- `GET /reports/exams/:id/dashboard` — analytics in one shot
- `GET /reports/exams/:id/live` — SSE stream for the dashboard
- `GET /reports/exams/:id/export.pdf` / `export.csv`
- `GET /reports/exams/:id/students/:sid/report.pdf`

