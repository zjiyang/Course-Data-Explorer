# C3 Design Document

## Declared Graded Area

**Datasets (v2)**

We chose `v2/datasets` as our graded area because this part of the codebase had 
the clearest responsibility-mixing problems. The original `POST /api/v2/datasets` 
handler mixed HTTP concerns, validation, job creation, ZIP orchestration, and 
background processing all in one place. This gave us a focused area to improve 
structure without changing external behaviour.

Our two PRs both target this area:
- PR #33 centralizes error handling for dataset lookup endpoints using typed 
  errors and middleware
- PR #34 extracts the `POST /api/v2/datasets` upload orchestration from `App.ts` 
  into `src/services/datasets.ts`

## Architecture Overview

After these two PRs, the datasets area is structured as follows:
```
Request
  ↓
App.ts (route handler)
  validates request fields (kind, archive)
  ↓
src/services/datasets.ts (acceptV2DatasetUpload)
  owns job creation, ZIP validation, background scheduling, kind-based dispatch
  ↓
DatasetModel interface
  abstracts over the Model class for persistence operations
  ↓
Model class (existing)
  handles file-backed persistence and dataset processing
```

Cross-cutting concerns live in:
- `src/models/errors.ts` — typed domain error classes with no Express coupling
- `src/middleware/index.ts` — `handleErrors`, `parsePagination`, `requireJsonBody`

This is not a full rewrite. We applied focused refactors in one graded area so 
that behaviour stays the same while the internal structure becomes cleaner.

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

`App.ts` creates a `Model` instance and passes it in. The service works against 
the interface, not the concrete class.

**Why:** The service can be tested by passing any object that satisfies the 
interface, without instantiating the full `Model` or touching the file system.

**Tradeoff:** `App.ts` still instantiates `new Model(datadir)` on every request 
rather than once at startup. A composition root approach would be cleaner, but 
was deferred to keep the PR scope narrow.

---

### 2. How will you structure validation?

**Choice: Per-route schema modules (validation inside the route handler)**

Request field validation for each endpoint lives inside its own route handler in 
`App.ts`. For example, `POST /api/v2/datasets` validates `kind` and `archive` 
inline before calling the service. Structural validation (body must be an object) 
is handled by `requireJsonBody` middleware in `src/middleware/index.ts`.

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
  middleware/
    index.ts          ← shared cross-cutting concerns
  models/
    errors.ts         ← shared domain error types
  services/
    datasets.ts       ← datasets feature owns its service
  App.ts              ← routes and HTTP entry points
```

The datasets feature owns its service file. Genuinely shared infrastructure 
(errors, middleware) lives in a small shared core. The existing `Model` class 
remains as the persistence layer for now.

**Why:** A developer working on dataset ingestion can find all relevant service 
code in `src/services/datasets.ts` without navigating a flat all-services-together 
layout. Adding a new dataset kind means adding logic to one service file.

**Tradeoff:** The vertical slice is not fully complete — there is no separate 
controller or repository file yet. The route handler in `App.ts` still handles 
both HTTP concerns and dependency setup. This is documented as remaining technical 
debt.

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
2. route validates `kind` and `archive`
3. route creates `Model` and calls `acceptV2DatasetUpload(...)`
4. service creates the dataset job
5. service schedules background processing via `setImmediate`
6. service validates ZIP format and dispatches by kind
7. route sends `202 Accepted`

For dataset lookup (`GET /api/v2/datasets/:id`):
1. handler calls `model.getDatasetJob(id)`
2. if not found, throws `NotFoundError`
3. `handleErrors` middleware maps it to `404`

---

## Before vs After Example

The refactor I want to highlight is the extraction of `POST /api/v2/datasets` 
upload orchestration from `App.ts`.

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

**After** — the route delegates to the service (~5 lines):
```ts
const accepted = await acceptV2DatasetUpload({
  kind: kind as DatasetKind,
  archiveBuffer: uploadedFile.buffer,
  model,
});
res.status(202).send(accepted);
```

The route now focuses on request validation and response sending. The service 
owns the upload workflow. This makes the route meaningfully thinner and gives 
the orchestration logic a clearer home.

> **PR #33 commit:** https://github.students.cs.ubc.ca/CPSC310-2025W-T2/project_team083/commit/2addbd3
> **PR #34 commit:** https://github.students.cs.ubc.ca/CPSC310-2025W-T2/project_team083/commit/bc21794

---

## Remaining Technical Debt

1. **No controller layer** — the route handler in `App.ts` still handles both 
   HTTP concerns and dependency setup. A dedicated controller file would complete 
   the vertical slice.

2. **No repository layer** — `Model` still handles file-backed persistence 
   directly. Introducing a `JobRepository` would satisfy Constraint 4 fully and 
   make the persistence layer independently testable.

3. **Model instantiated per request** — `new Model(datadir)` is created inside 
   the handler on every request. A composition root at startup would be cleaner.

4. **Validation still inline** — field validation for most endpoints still lives 
   inside route handlers. A later refactor could move this into dedicated 
   validation middleware or per-resource schema modules.

5. **Most handlers not yet migrated** — only the dataset lookup endpoints use 
   `next(err)` with `handleErrors`. V1 courses, sections, and search still use 
   inline error responses.
