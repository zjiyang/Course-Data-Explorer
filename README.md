# Course Data Explorer

A full-stack data explorer for UBC course and campus-facilities data: upload zipped datasets, query them through a small REST API with a custom filter/aggregation DSL, and browse the results in a React frontend with three data-insight charts.

This started as a team project for CPSC 310 (UBC Software Engineering, 2025W T2), built with Joanna Feng. After the course ended, I rewrote the frontend in React + TypeScript and did some backend cleanup as a personal portfolio exercise — see [Origin & changes since the course](#origin--changes-since-the-course) below.

## What it does

- **Upload** a zip of UBC course-section data (`POST /api/v1/datasets`) or campus-facilities/room data (`POST /api/v2/datasets`). Parsing happens as a background job; poll `GET /api/v1/jobs/:id` for status.
- **Query** the parsed data with a JSON body language supporting `AND`/`OR`/`NOT`, comparisons (`GT`/`LT`/`EQ`/`IS`), column projection, sorting, and grouped aggregation (`COUNT`/`SUM`/`AVG`/`MIN`/`MAX`) — `POST /api/v1/query` and `POST /api/v2/query`.
- **Browse** courses, sections, buildings, and rooms directly via paginated list endpoints.
- **Visualize** the uploaded course data in the frontend: department average grades, grade trends over time per department, and grade-average vs. failure-rate per course.

## Tech stack

| | |
|---|---|
| Backend | Node.js, TypeScript, Express 5 |
| Frontend | React 18, TypeScript, Vite |
| Charts | Chart.js via react-chartjs-2 |
| Parsing | JSZip (course archives), parse5 (facilities HTML), decimal.js (precision-safe averaging) |
| Testing | Mocha, Chai, Supertest, nyc (coverage) |
| CI | GitHub Actions (typecheck, prettier, tests, frontend build) |

Data is persisted as JSON files on disk (no external database) — a deliberate simplification for the project's scope, not a production storage choice.

## Architecture

```
src/
  index.ts                       entry point, reads PORT / DATA_DIR
  App.ts                         Express app: routes, query-DSL parser/evaluator, geolocation lookup
  controllers/                   dataset upload / job-status handlers
  services/datasets.ts           background parsing jobs (course zips, facilities zips)
  repositories/jobRepository.ts  in-memory job-status store
  middleware/                    pagination parsing, JSON-body validation, error handling
  models/errors.ts               typed domain errors -> HTTP status mapping

frontend/src/
  api.ts, types.ts               typed client for the backend REST API
  hooks/                         useCourseExplorer, useInsights — data fetching + derived state
  components/                    UploadPanel, FiltersPanel, ResultsTable
  insights/                      the three Chart.js insight panels
  legacy-vanilla/                original (pre-rewrite) vanilla JS/HTML/CSS frontend, kept for reference
```

## Running locally

Requires Node 24.x and Yarn 1.22.x.

```bash
# backend
yarn install
yarn build      # typecheck + prettier check
yarn test       # mocha test suite
yarn start      # serves the API and the built frontend on http://localhost:4321

# frontend (separate terminal, for active frontend development)
cd frontend
yarn install
yarn dev        # Vite dev server on :5173, proxies /api to :4321
```

For a production-style run, build the frontend (`yarn build` inside `frontend/`) and start the backend (`yarn start` at the root) — it serves `frontend/dist` directly.

### Try it with sample data

Open the running frontend and click **Try Sample Data** in the upload panel — it uploads a bundled real UBC course/grade-distribution dataset ([`frontend/public/samples/courses-dataset.zip`](frontend/public/samples/courses-dataset.zip)) with no file picker needed, so you can immediately see courses/sections and the insight charts populate.

## Known limitation: facilities geolocation

Facilities-dataset uploads (`/api/v2/datasets`) look up each building's coordinates via a UBC-internal geocoding service (`cs310.students.cs.ubc.ca`), which is only reachable from UBC's network. Outside that network, facilities uploads will fail to attach coordinates (and the related tests will fail for the same reason) — this is an environment dependency from the original course infrastructure, not a bug in this codebase. Course-dataset uploads and queries are unaffected.

## Data insights

The frontend's insights panel renders three charts, computed entirely from data already returned by the backend API.

**Department average grades (bar chart).** Average grade per department, across all sections and years in the dataset, color-coded from red (lower) to blue (higher). Sortable alphabetically or by average, with a top-20/top-40/all view. Useful for spotting departments whose grading is a noticeable outlier relative to the rest of campus, without writing a query by hand.

**Grade trends over time (line chart).** Average grade for a selected department, by academic year (year-1900 summary rows are filtered out). Useful for seeing whether a department's grades are trending up, down, or had a sudden shift in a specific year worth investigating.

**Grade average vs. failure rate (scatter chart).** Each course plotted by average grade (x) and failure rate (y), color-coded by failure rate, filterable by department and minimum enrollment. Average grade alone doesn't show how a course is actually going for students — a 75-average course with a 15% failure rate is a different situation than a 68-average course with almost none. This view is meant to help surface courses where targeted support would matter most.

## Origin & changes since the course

The backend (Express app, query-DSL parser/evaluator, dataset parsing, test suite) is the team project as submitted, with light polish afterward: wiring up a previously-unused pagination middleware onto the list endpoints, and fixing project metadata. The original vanilla JS/HTML/CSS frontend is kept under `frontend/legacy-vanilla/` for reference; the current frontend is a from-scratch React + TypeScript rewrite with the same features and API usage, done independently after the course concluded.
