# C3 Design Document

## Declared Graded Area

**Datasets (v2)**

We chose `v2/datasets` as our graded area because this part of the codebase had
the clearest responsibility-mixing problems. The original `POST /api/v2/datasets`
handler mixed HTTP concerns, validation, job creation, ZIP orchestration, and
background processing all in one place. This gave us a focused area to improve
structure without changing external behaviour.

Our PRs all target this area:
- PR #33 centralizes error handling for dataset lookup endpoints using typed
  errors and middleware
- PR #34 extracts the `POST /api/v2/datasets` upload orchestration from `App.ts`
  into `src/services/datasets.ts`
- PR #37 introduces `JobRepository` to isolate dataset job reads from the lookup path

Beyond the graded PRs, we also introduced a controller layer for the datasets
slice. `parsePagination` was introduced as reusable middleware, but it has not
yet been applied to all list routes.

## Architecture Overview

After these refactors, the datasets area is structured as follows:
```
Request
  ↓
App.ts (route handler)
  validates request fields (kind, archive) — HTTP concern only
  ↓
src/controllers/datasetsController.ts (makeDatasetsController)
  reads req, calls service or repository, writes res
  no business logic, no direct persistence access
  ↓
src/services/datasets.ts (acceptV2DatasetUpload)
  owns job creation, ZIP validation, background scheduling, kind-based dispatch
  ↓
DatasetModel interface
  abstracts over the Model class for persistence operations
  ↓
src/repositories/jobRepository.ts (JobRepository)
  reads dataset job records from disk for GET /api/v2/datasets/:id
  ↓
Model class (existing)
  handles file-backed persistence for upload processing
```

Cross-cutting concerns live in:
- `src/models/errors.ts` — typed domain error classes with no Express coupling
- `src/middleware/index.ts` — `handleErrors`, `parsePagination`, `requireJsonBody`

Module layout:
```
src/
  controllers/
    datasetsController.ts   ← v2/datasets HTTP layer
  middleware/
    index.ts                ← shared cross-cutting concerns
  models/
    errors.ts               ← shared domain error types
  repositories/
    jobRepository.ts        ← dataset job persistence (reads)
  services/
    datasets.ts             ← datasets upload workflow
  App.ts                    ← routes, global middleware, dependency wiring
```

This is not a full rewrite. We applied focused refactors in the declared graded
area so that behaviour stays the same while the internal structure becomes cleaner.

## Four Required Design Decisions

### 1. How will services access repositories?

**Choice: Dependency injection via interface**

The service (`acceptV2DatasetUpload`) does not import `Model` directly. Instead,
it accepts a `DatasetModel` interface that declares only the methods it needs:
```ts
type DatasetModel = {
  createDatasetJob(id: string, kind: DatasetKind): Promise<void>;
  failDatasetJob(id: string, message: string): Promise<void>;
  processCourseOfferingsZip(id: string, zip: JSZip): Promise<void>;
  processFacilitiesZip(id: string, zip: JSZip): Promise<void>;
};
```

`makeDatasetsController` receives a `model` that satisfies this interface.
`App.ts` passes a `new Model(datadir)` instance at startup — once, not on every
request. PR #37 takes this further by introducing `JobRepository` so that
`GET /api/v2/datasets/:id` no longer depends on `Model` at all for job lookups —
it calls `jobRepo.getById` directly inside the controller.

**Why:** The service and controller can be tested by passing any object that
satisfies the interface, without instantiating the full `Model` or touching the
file system.

**Tradeoff:** A full composition root would wire all dependencies in a single
setup module before `createApp` is called. Our current approach wires the
datasets controller inside `createApp`, which still couples the wiring to the
application startup function. This is documented as remaining technical debt.

---

### 2. How will you structure validation?

**Choice: Per-route schema modules (validation inside the route handler)**

Request field validation for each endpoint lives inside its own route handler in
`App.ts`. For example, `POST /api/v2/datasets` validates `kind` and `archive`
inline before delegating to the controller. Structural validation (body must be
an object) is handled by `requireJsonBody` middleware in `src/middleware/index.ts`.
The `parsePagination` middleware in `src/middleware/index.ts` has been defined as
shared reusable middleware for pagination validation and is available to be
composed into list routes in a follow-up PR.

**Why:** The dataset upload endpoint uses `multipart/form-data` via multer, which
makes the body shape different from regular JSON endpoints. The specific
validation rules for `kind` and `archive` are intrinsic to this one endpoint and
not shared elsewhere, so co-location is simpler and correct.

**Tradeoff:** If a second upload endpoint were added with the same field
requirements, the validation logic would need to be extracted into a shared
helper. For the current scope, co-location avoids premature abstraction.

---

### 3. How will you represent domain errors?

**Choice: Custom Error subclasses**

We defined typed error classes in `src/models/errors.ts` with no Express
coupling:
```ts
export class NotFoundError extends Error { ... }
export class ValidationError extends Error {
  public readonly fields?: Record<string, string>;
}
export class TooManyResultsError extends Error {
  public readonly limit: number;
}
export class InvalidQueryError extends Error { ... }
```

Services and handlers throw typed errors. The centralised `handleErrors`
middleware in `src/middleware/index.ts` maps them to HTTP responses using
`instanceof`:
```ts
if (err instanceof NotFoundError)
  res.status(404).send({ error: "Not found", message: err.message });
```

**Why:** Services remain Express-free — they throw without knowing about status
codes. TypeScript's `instanceof` gives compile-time safety. All error-to-HTTP
mapping is centralised in one place so changing a response shape requires editing
one file.

**Tradeoff:** Every handler must remember to use `try/catch` and call `next(err)`
to route errors through `handleErrors`. A result-style `Ok`/`Err` approach would
make the error path explicit in type signatures, but requires more boilerplate at
every call site.

---

### 4. How will you organize your modules?

**Choice: Hybrid feature-first**
```
src/
  controllers/
    datasetsController.ts   ← datasets feature owns its controller
  middleware/
    index.ts                ← shared cross-cutting concerns
  models/
    errors.ts               ← shared domain error types
  repositories/
    jobRepository.ts        ← dataset job persistence
  services/
    datasets.ts             ← datasets feature owns its service
  App.ts                    ← routes and HTTP entry points
```

The datasets feature owns its controller, service, and repository files.
Genuinely shared infrastructure (errors, middleware) lives in a small shared
core. The existing `Model` class remains as the persistence layer for upload
processing and all V1/V2 CRUD operations for now.

**Why:** A developer working on dataset ingestion can find all relevant code
without navigating a flat layout. The datasets area now has a clearer layered structure. The lookup path goes
through route → controller → repository, while the upload path goes through
route → controller → service and still relies on the existing `Model`
abstraction for persistence operations.

**Tradeoff:** The vertical slice is complete for the datasets graded area, but
other resources (courses, sections, buildings, rooms, search) have not yet been
given their own controller files. They remain in `App.ts` as route handlers
calling `Model` directly. This is documented as remaining technical debt.

---

## Request Flow

### Before
`POST /api/v2/datasets` handled the full upload flow inline in `App.ts`:

1. validate `kind` and `archive`
2. create dataset job
3. build accepted response
4. schedule background processing with `setImmediate`
5. validate ZIP format
6. dispatch based on dataset kind
7. handle failure paths

### After
1. request enters `POST /api/v2/datasets` in `App.ts`
2. route validates `kind` and `archive` (HTTP concern)
3. route calls `datasetsController.uploadV2Dataset(req, res)`
4. controller calls `acceptV2DatasetUpload(...)` in service layer
5. service creates the dataset job
6. service schedules background processing via `setImmediate`
7. service validates ZIP format and dispatches by kind
8. controller sends `202 Accepted`

For dataset lookup (`GET /api/v2/datasets/:id`):

1. route delegates directly to `datasetsController.getV2Dataset`
2. controller calls `jobRepo.getById(id)`
3. if not found, throws `NotFoundError`
4. `handleErrors` middleware maps it to `404`

For list endpoints (`GET /api/v1/courses`, `GET /api/v2/buildings`, etc.):

1. handler reads `req.query.limit` and `req.query.offset` inline
2. validates range and returns `400` if invalid
3. calls `Model` and slices results

---

## Before vs After Example

### Service extraction for dataset upload (PR #34)

**Before** — the route handler owned the full workflow (~70 lines):
```ts
// all of this was inline in the route handler
const id = `upload_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
await model.createDatasetJob(id, datasetKind);
res.status(202).send({ id, status: "processing", kind: datasetKind, message: "..." });
setImmediate(async () => {
  // ZIP validation, kind dispatch, failure handling
});
```

**After** — the route validates, controller delegates, service owns the workflow:
```ts
// In App.ts route: validate only
await datasetsController.uploadV2Dataset(req, res);

// In datasetsController.ts: read req, call service, write res
const accepted = await acceptV2DatasetUpload({ kind, archiveBuffer, model });
res.status(202).send(accepted);
```

The controller now focuses on reading `req` and writing `res`. The service owns
the upload workflow. This makes both layers easier to read and test independently.

> **PR #34 commit:** https://github.students.cs.ubc.ca/CPSC310-2025W-T2/project_team083/commit/bc21794

---

## Remaining Technical Debt

1. **Controller layer only covers datasets** — `courses`, `sections`,
   `buildings`, `rooms`, and `search` routes remain in `App.ts` as large inline
   handlers. A follow-up refactor could extract controllers for each resource
   area, completing the vertical slice pattern across the whole codebase.

2. **Repository layer partially introduced** — `JobRepository` now handles
   dataset job reads for `GET /api/v2/datasets/:id`. Write operations (create,
   fail, complete) are still on `Model` via the upload service and could be
   moved into the repository in a follow-up.

3. **Wiring still inside createApp** — `makeDatasetsController` is called inside
   `createApp`. A composition root at the application entry point (`index.ts`)
   would be a cleaner separation, but was deferred to keep changes narrow.

4. **Validation still inline for CRUD endpoints** — field validation for PUT
   courses, PUT sections, PUT buildings, and PUT rooms still lives inside route
   handlers. A later refactor could move these into dedicated validation
   middleware or per-resource schema modules.

5. **Most handlers not yet migrated to handleErrors** — V1 courses, sections,
   and search still use inline error responses. Only the dataset lookup endpoints
   and the controller-backed routes use `next(err)` with `handleErrors`.
