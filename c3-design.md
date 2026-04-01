# C3 Design Document

## Declared graded area
**Datasets (v2)**

We chose `datasets` as our graded area because this part of the code had the clearest responsibility-mixing problems and gave us a good opportunity to improve structure without changing external behaviour.

Our two PRs both focus on the same graded area:

- the first PR centralizes dataset lookup error handling using typed errors and middleware
- the second PR extracts the `POST /api/v2/datasets` upload orchestration from `App.ts` into `src/services/datasets.ts`

This keeps the refactor direction consistent within one area instead of mixing in unrelated cleanup.

## Architecture overview
After these refactors, the `datasets` area is organized more clearly:

- **`App.ts`**  
  Handles routes, request-level validation, dependency setup, and HTTP responses
- **`middleware`**  
  Handles cross-cutting concerns such as centralized error mapping
- **`services`**  
  Handles workflow orchestration that does not need to live directly in route handlers
- **`models/errors.ts`**  
  Defines typed domain errors without Express coupling
- **`Model`**  
  Still handles file-backed persistence and dataset processing

This is not a full rewrite of the whole system. Instead, we used small, focused refactors in one graded area so that behaviour stays the same while the internal structure becomes easier to understand and maintain.

## Design decisions

### 1. Centralize dataset lookup error handling in middleware
Originally, `GET /api/v1/datasets/:id` and `GET /api/v2/datasets/:id` both built their own `404` responses inline in the route handler. We changed this so that the routes throw `NotFoundError`, and `handleErrors` maps that error to a `404` response in one place.

This improves separation of concerns because route handlers no longer own repeated response-shape construction for dataset-not-found cases. It also reduces duplication and makes the external `404` shape easier to keep consistent.

### 2. Keep typed domain errors independent from Express
We defined `NotFoundError`, `ValidationError`, `TooManyResultsError`, and `InvalidQueryError` in `src/models/errors.ts` without importing Express.

This keeps inner-layer logic independent from HTTP framework details. A service or lower-level module can throw a domain error without needing to know how that error will be converted into an HTTP status code. That responsibility stays in middleware, which keeps dependency direction cleaner.

### 3. Extract `POST /api/v2/datasets` upload orchestration into a service
This was the main change in my PR.

Before the refactor, `POST /api/v2/datasets` was doing all of the following in one route handler:

- request validation
- dataset job creation
- accepted response construction
- ZIP validation
- background scheduling
- kind-based dispatch

I moved that upload-processing orchestration into `src/services/datasets.ts` through `acceptV2DatasetUpload(...)`.

Now the route mainly handles:

- request-level validation
- creating `Model`
- calling the service
- sending the `202` response

This makes the route thinner and gives the upload workflow a clearer place to live.

### 4. Depend on a smaller interface in the service layer
Inside `src/services/datasets.ts`, the service does not depend directly on the full concrete `Model` type. Instead, it uses a `DatasetModel` interface that only includes the methods needed by the upload workflow.

This keeps the service dependency smaller and makes the service easier to test in isolation. Even though `App.ts` still passes a real `Model` instance, the service itself is now written against a narrower interface.

## Request flow

### Before
Before the refactor, `POST /api/v2/datasets` handled almost the full upload flow inside `App.ts`:

1. validate `kind` and `archive`
2. create dataset job
3. build accepted response
4. schedule background processing with `setImmediate(...)`
5. validate ZIP format
6. dispatch based on dataset kind
7. handle failure paths

This meant a single route handler was responsible for both HTTP logic and upload workflow orchestration.

### After
After the refactor, the flow looks like this:

1. request enters `POST /api/v2/datasets`
2. the route performs request-level validation
3. the route creates `Model`
4. the route calls `acceptV2DatasetUpload(...)`
5. the service creates the dataset job
6. the service schedules background processing
7. the service validates ZIP format and dispatches by dataset kind
8. the route returns `202 Accepted`

Also, dataset lookup errors are now mapped through middleware instead of being built inline by each route.

## Before vs After example
The refactor I want to highlight most is the extraction of the `POST /api/v2/datasets` upload workflow out of `App.ts`.

### Before
Before this refactor, the `POST /api/v2/datasets` route directly handled multiple responsibilities in one place. After validating the request, it generated the dataset job ID, created the dataset job, constructed the `202 Accepted` response payload, scheduled background processing with `setImmediate(...)`, validated the uploaded ZIP, and dispatched processing based on dataset kind.

This meant the route mixed HTTP concerns with upload workflow orchestration, which made it longer and harder to reason about.

### After
After this refactor, the route still performs request-level validation and still returns the same `202 Accepted` response, but it now delegates the upload-processing orchestration to `acceptV2DatasetUpload(...)` in `src/services/datasets.ts`.

This creates a clearer split of responsibilities:

- `App.ts` handles the HTTP entry point, validation, dependency setup, and response sending
- `src/services/datasets.ts` handles job creation, accepted-response data construction, ZIP validation, background scheduling, and kind-based dispatch

I am proud of this refactor because it makes the route meaningfully thinner without changing the external behaviour of the endpoint.

### Specific commit link
- [PR #34 service extraction commit](https://github.students.cs.ubc.ca/CPSC310-2025W-T2/project_team083/commit/bc217944ef9b307dc7e79dfd3dba61ca8b1d2f8d)

## Remaining technical debt
There is still some technical debt left in this graded area.

1. **`Model` lifecycle**  
   `App.ts` still creates `new Model(datadir)` inside handlers. That is fine for the current scope, but a cleaner composition-root style setup could be a future improvement.

2. **Validation is still mostly inline**  
   A lot of request validation still lives inside route handlers. A later refactor could move more of this into dedicated validation helpers or middleware.

3. **The datasets area is not fully migrated yet**  
   Error handling and upload orchestration are cleaner now, but the whole area is not fully refactored yet.

4. **`Model` is still large**  
   The service boundary is clearer than before, but processing and persistence are still concentrated in a large `Model` class. More separation could be done later if needed.