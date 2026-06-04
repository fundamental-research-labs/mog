# Query Executor Service Boundary and Result Behavior Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/services/query-executor`

Queue item: 84

Scope: the kernel query execution service boundary, its connection registry/resolver contract, cache key and result cache behavior, query execution result/error semantics, and the integration points that expose this service as a per-document kernel service.

Files observed in scope:

- `kernel/src/services/query-executor/types.ts`: kernel-local connection, query result, error, cache entry, event, resolver, and executor interfaces.
- `kernel/src/services/query-executor/query-executor.ts`: private `QueryExecutor` implementation and `createQueryExecutor()` factory.
- `kernel/src/services/query-executor/query-cache.ts`: LRU cache implementation and cache key builder.
- `kernel/src/services/query-executor/index.ts`: service barrel exports.
- `kernel/src/services/query-executor/__tests__/query-executor.test.ts`: active registry/cache/resolver/lifecycle tests plus skipped execution/event tests.
- `kernel/src/services/query-executor/__tests__/query-cache.test.ts`: active cache and cache-key tests.

Production integration points that must be considered:

- `kernel/src/context/kernel-context.ts`, where `createDocumentContext()` creates `services.queryExecutor = createQueryExecutor()` and disposes it during document teardown.
- `kernel/src/services/index.ts`, which re-exports the service factory and types.
- `types/api/src/services/index.ts`, where `IKernelServices.queryExecutor` is exposed through a minimal, weakly typed public service contract.
- `types/connections/src/query.ts`, where QUERY/CONN formula-level contracts and marker types exist.
- `kernel/src/api/app/capability-gated/scoped-connections-api.ts`, which defines a separate app-facing connections capability surface with `connections:read` for portable query and `connections:native` for raw/native execution.
- `docs/security/DATA-FLOW-AND-EGRESS.md` and `docs/internals/spreadsheet/foundations.md`, which currently state that native database query execution is removed/not shipped and that host-supplied executors/providers remain deployment-controlled.

This plan does not treat `query-executor` as an invitation to add database client libraries to kernel. The correct production boundary is a typed, host-supplied query execution port with no default network egress.

## Current role of this folder in Mog

`query-executor` is currently a small per-document kernel service. It is created with clipboard, undo, and notifications, survives for the document lifetime, and is disposed with the document context. It provides:

- A local in-memory connection registry keyed by connection display name.
- An optional external `IConnectionResolver` whose result takes precedence over the local registry.
- A standalone LRU query cache with metadata storage.
- A cache key helper that uses `connectionId`, trimmed SQL, and JSON-stringified params.
- An `executeQuery()` method that resolves the connection, then always returns an `execution_error` stating that database query execution was removed from this build.
- A `query:complete` event subscription surface whose private emitter is currently unused because there is no success path.

Source search found no production caller of `executeQuery()`, `registerConnection()`, or `onQueryComplete()` outside tests. QUERY/CONN formula marker types exist in `types/connections`, but no current compute/formula implementation was found that emits `QueryRequest` markers into this service.

The active tests cover registry operations, resolver precedence, cache operations, invalidation, stats, and disposal. The tests that describe bridge-backed execution, query completion events, and resolver-backed execution are skipped. That skipped coverage is stale evidence of an older execution model, not a verified production path.

## Improvement objectives

1. Make the service boundary explicit: kernel owns query descriptors, cache state, normalization, and result/error contracts; a trusted host owns credentials, network/database clients, authorization, and actual execution.
2. Preserve the current no-default-egress security posture. A document with no host query provider must never run SQL or call a network/database endpoint by default.
3. Replace the ambiguous `executeQuery()` behavior with a complete production pipeline: resolve connection, normalize request, check cache, optionally dedupe in-flight execution, call the host provider, normalize the result, populate cache, emit completion events, and return typed errors for every failure class.
4. Remove credential-shaped state from the kernel service. Kernel connection records should be descriptors or handles, not raw passwords.
5. Replace weak result typing with a coherent `Result<QueryExecutionSuccess, QueryExecutionError>` contract. Successful `ok` values should contain required data and metadata; failures should live in `err`, not as `QueryResult.success = false`.
6. Make query cache behavior collision-resistant, metadata-preserving, immutable to callers, and exact in invalidation semantics.
7. Align kernel service types, `types/api` service contracts, `types/connections` formula contracts, API snapshots, docs, and tests so they describe one boundary.
8. Keep the app-facing `connections` capability gate separate and explicit. Raw/native SQL must not become reachable through `services.queryExecutor` without the same host/capability policy.
9. Convert skipped query-executor tests into active provider-boundary tests, and add coverage for unsupported/no-provider behavior rather than relying on comments.

## Production-path contracts and invariants to preserve or strengthen

- No native database client, fetch call, transport, or network egress is introduced inside `kernel/src/services/query-executor`.
- If no execution provider is installed, `executeQuery()` returns a typed unavailable error after connection resolution. It does not throw and does not use the generic `execution_error` bucket for an expected missing-provider condition.
- Resolver precedence remains stable: external resolver results win over local registry records; local registry is only the fallback.
- Cache identity uses stable connection IDs, not display names. Display-name renames must not create stale cache aliases.
- Connection removal invalidates by exact connection ID stored on cache entries, not by string-prefix matching over a delimiter-formatted key.
- Query params are normalized before cache lookup and provider execution. Unsupported values such as functions, symbols, non-finite numbers, BigInt, cyclic objects, class instances, and provider-specific opaque objects are rejected with a typed parameter error.
- SQL normalization trims surrounding whitespace but does not lowercase or otherwise alter SQL text, because case changes can corrupt string literals and quoted identifiers.
- Successful query results are rectangular `CellValue[][]` matrices. `rowCount` equals the number of returned rows; a separate optional `totalRowCount` can represent provider-known upstream row count when truncation occurs.
- Column metadata length, when present, matches result width. Empty result sets must still be able to preserve column names and types.
- Cached entries preserve all result metadata needed to faithfully return a cache hit, not only cell data.
- Cache reads do not expose mutable service-owned arrays. Results are deep-frozen, structurally readonly, or cloned on ingress/egress with a documented policy.
- Cache capacity is validated. Zero, negative, non-integer, and non-finite capacities must not silently produce inconsistent storage.
- Concurrent identical cache misses dedupe to one host execution and one cache write. Distinct queries and refreshes remain independent.
- Completion events fire only for fresh successful executions that commit a cache entry, not for failed executions. Cache-hit event behavior must be explicitly specified; default should be no completion event because no asynchronous execution completed.
- No completion or error event may fire after service disposal. In-flight provider promises resolving after disposal must not repopulate cache.
- Query errors are typed and preserve useful detail without leaking credentials. At minimum: `connection_not_found`, `execution_unavailable`, `authorization_denied`, `parameter_error`, `timeout`, `network_error`, `invalid_sql`, `result_too_large`, `provider_error`, and `execution_error`.
- Public app APIs remain capability-gated. Portable host query operations stay behind `connections:read`; raw/native SQL or mutation execution stays behind `connections:native` or a stronger host-only policy.
- If QUERY formula execution is implemented, recalc integration must use the real compute/kernel formula path and real UI input paths in E2E tests; it must not be proven only by directly calling the service.

## Concrete implementation plan

1. Define the boundary contract before changing behavior.

   Add or replace types in `kernel/src/services/query-executor/types.ts`:

   - `QueryConnectionDescriptor`: `id`, `name`, `type`, display metadata, capabilities, and optional host reference. Do not include `password` or raw credential fields.
   - `QueryExecutionProvider`: host-supplied port with `execute(request, context): Promise<Result<QueryExecutionSuccess, QueryExecutionError>>`.
   - `QueryExecutionRequest`: `connectionId`, `connectionName`, normalized `sql`, normalized params, `timeoutMs`, `maxRows`, `includeHeaders`, request ID, and refresh/cache policy.
   - `QueryExecutionSuccess`: required `data`, required `rowCount`, optional `columnNames`, `columnTypes`, `executionTimeMs`, `truncated`, `totalRowCount`, `source`, and provider diagnostics that are safe to expose.
   - `QueryExecutionError`: discriminated error object with `type`, `message`, safe `details`, optional provider request ID, and no credential-bearing data.
   - `QueryExecutorOptions`: cache options, resolver, provider, clock, and optional cache serializer hooks for deterministic tests.

   Keep `createQueryExecutor()` as the factory and keep the concrete class private.

2. Remove credential-bearing connection state from the service.

   Replace the current `ConnectionConfig` shape with a descriptor or split it into public descriptor plus host-private config. The kernel local registry should only hold non-secret descriptors. If any current callers still expect username/password fields, move those call sites to a host-owned resolver/provider and make the kernel receive only a connection ID/handle.

   Align this descriptor with `types/connections/src/query.ts` and `types/document/src/storage/connection.ts` where possible, but do not collapse table/storage connections and QUERY formula connections unless their authorization and result contracts are identical. They currently cover different provider sets and capability surfaces.

3. Rework cache identity and cache storage.

   Replace raw `${connectionId}|${sql}|${params}` keys with a structured key strategy:

   - Normalize request identity into a versioned object: `{ version, connectionId, sql, params, includeHeaders, maxRows, providerScope? }`.
   - Canonically serialize params with stable object key ordering and explicit handling for null, booleans, finite numbers, strings, blanks, dates if supported, and error values if supported.
   - Hash or length-prefix the canonical identity so delimiter collisions cannot occur.
   - Store `connectionId` as a separate field on every cache entry so invalidation is exact.

   Change `QueryCacheEntry` to store the full normalized success result plus `cacheKey`, `connectionId`, `cachedAt`, optional `expiresAt`, and request identity metadata. Add `getResultEntry()` or replace `getCachedResult()` with a metadata-preserving read. If a compatibility read remains, it must be a projection over the full entry, not the only cache API.

4. Make cached data immutable by contract.

   On cache write, clone or freeze the result matrix and metadata. On cache read, return readonly data or a defensive clone. Choose one policy and test it. For large results, prefer immutable readonly storage plus documented caller discipline if deep clone cost is unacceptable, but enforce it mechanically in development tests.

5. Implement the production `executeQuery()` pipeline.

   The method should:

   - Resolve the connection descriptor through resolver then local registry.
   - Return `connection_not_found` if missing.
   - Normalize SQL, params, options, and cache policy.
   - Build the structured cache key from connection ID and normalized request identity.
   - Return a cache-hit success when allowed and present.
   - Return `execution_unavailable` if no provider is installed.
   - Dedupe identical in-flight cache misses unless a manual refresh policy asks to bypass cache.
   - Call the host provider with normalized request and safe context.
   - Normalize the provider success result into the service result contract.
   - Validate row/column invariants and max-row/truncation behavior before caching.
   - Cache only successful results that are allowed by policy.
   - Emit `query:complete` once for a fresh successful execution that committed.
   - Map provider failures into typed errors and avoid caching or completion events for failures.

6. Define refresh and invalidation semantics.

   Add explicit methods or options for:

   - `invalidateCache(connectionId?)`: exact connection invalidation or full clear.
   - `refreshQuery(connectionName, sql, params, options?)`: bypass cache, execute through provider, then replace cache.
   - `getCacheStats()`: include capacity, hit rate, in-flight count, invalidation count, and optionally per-connection counts if useful.

   If the existing `executeQuery()` accepts a cache-bypass option, make the option explicit rather than overloading params.

7. Fix event and lifecycle behavior.

   Replace the private unused `emitQueryComplete()` path with an event contract that is tested:

   - `query:complete`: fresh success and cache commit.
   - Optional `query:error`: only if consumers need observable failures; otherwise keep errors in the returned `Result`.
   - Optional `query:cache-invalidated`: if formula/query marker recomputation depends on invalidation.

   Track a disposed flag. Dispose must clear local registry, cache, event handlers, and in-flight bookkeeping, and it must prevent late provider completions from mutating state.

8. Align public contracts and exports.

   Update `types/api/src/services/index.ts` so `IQueryExecutor` is not a weak `unknown` surface. It should either reference the real query-executor contract types or explicitly mark this service as infrastructure-internal and expose a narrower public-safe surface.

   If the query executor becomes a supported package subpath, add an intentional `@mog-sdk/kernel/services/query-executor` export and update public API snapshots. If it remains an internal service reachable only through `IKernelServices`, keep it out of package subpath exports and make docs say so.

9. Coordinate with the app connections capability boundary.

   Do not wire `query-executor` directly into apps as an unrestricted SQL API. If app queries should use the same provider, add an adapter that enforces the existing capability split:

   - `connections:read` can call portable, structured query APIs.
   - `connections:write` can call mutation APIs only if the host exposes them.
   - `connections:create` can create/delete host connection records.
   - `connections:native` is required for raw SQL/native execution.

   The kernel service should accept an already-authorized host/provider context or require a caller context that the provider can authorize. Do not let the per-document service bypass `createScopedConnectionsAPI()`.

10. Decide and implement QUERY formula integration deliberately.

   The current service comments describe calculator `QueryRequest` markers, but source search found only type definitions. Before wiring formula behavior, inspect the compute formula implementation and decide one of two production contracts:

   - If QUERY formulas are intended to ship now, implement the real marker path from compute result to kernel service execution, cache hit reuse, spill placement, headers, refresh policies, parameter dependency invalidation, and re-evaluation on completion.
   - If QUERY formulas are still reserved, remove or rewrite comments/tests/docs that imply an active marker interception path, while keeping the typed contract reserved.

   Do not leave comments claiming a production recalc interception flow that does not exist.

11. Replace skipped tests with active contracts.

   Update `query-executor.test.ts` so no behavior section is skipped. Use an injected fake `QueryExecutionProvider`, not a fake bridge from the removed execution path. Cover unsupported/no-provider behavior as a first-class path.

   Update `query-cache.test.ts` for structured key, canonical param serialization, capacity validation, exact invalidation, metadata preservation, immutability, stats, and collision cases.

12. Update docs and security inventory.

   If behavior remains no-provider by default, docs should say: query executor is a per-document service with cache/descriptors and host execution port support; default public build has no provider and therefore no database egress.

   If a host provider is added for a distribution, security docs must describe authorization, destinations, credentials custody, max rows/timeouts, audit/log retention, and disablement controls.

## Tests and verification gates

Focused tests to add or update:

- `kernel/src/services/query-executor/__tests__/query-executor.test.ts`
  - Missing connection returns `connection_not_found`.
  - Existing connection with no provider returns `execution_unavailable`.
  - Resolver result wins over local registry.
  - Provider success returns normalized `ok` result and writes a full metadata-preserving cache entry.
  - Provider errors map to typed errors and do not write cache.
  - Cache hit returns data and metadata without invoking provider.
  - Manual refresh bypasses cache and replaces the entry.
  - Concurrent identical cache misses dedupe to one provider call.
  - Completion event fires once after fresh success and not on cache hit, error, unavailable provider, or after dispose.
  - Disposal clears cache/registry/events and suppresses late provider completion.
  - Credential fields are not accepted or exposed in kernel descriptors.

- `kernel/src/services/query-executor/__tests__/query-cache.test.ts`
  - Structured keys avoid delimiter collisions.
  - SQL trim preserves case and string literals.
  - `undefined` params and empty params behavior is explicitly tested.
  - Canonical params reject unsupported values and stabilize object-key ordering.
  - Capacity rejects zero/negative/non-finite values or implements a documented disabled-cache mode.
  - Metadata is stored and returned with results.
  - Invalidation by connection ID does not remove similarly prefixed connection IDs.
  - Cached rows/metadata cannot be mutated through returned references.

- Contract/API tests
  - `types/api/src/services/index.ts` exposes the intended typed service surface, or explicitly omits execution details if internal.
  - API snapshot changes are intentional if public contracts move.
  - App capability-gated connections tests continue to prove `connections:read` does not expose `executeNative`, and `connections:native` is required for raw/native execution.

- QUERY formula/integration tests if the formula path is implemented
  - QUERY/CONN formulas reach the service through the real compute/kernel path.
  - Parameters derived from cell values invalidate/recompute through real formula dependency changes.
  - Spill placement, headers, errors, truncation, cache hits, and refresh policies work through production workbook APIs.
  - Browser E2E uses real UI input and formula entry, not direct service mutation.

Verification commands for an implementation workstream:

- `cd mog/kernel && pnpm test -- src/services/query-executor`
- `cd mog/kernel && pnpm typecheck`
- `cd mog && pnpm typecheck`
- `cd mog && pnpm check:api-snapshots` if public API or declaration output changes
- `cd mog && pnpm check:publish-readiness:fast` if package exports, public boundaries, or release naming change
- `cd mog && pnpm test -- kernel/src/api/app/capability-gated` if the app connections boundary is touched
- If QUERY formula integration touches Rust compute or generated bridges: run the relevant `cargo test -p <crate>`, `cargo clippy -p <crate>`, and bridge generation gates required by those changes.
- If UI formula workflows are added: run the dev server and exercise real formula/query entry in the browser.

## Risks, edge cases, and non-goals

- Risk: adding a provider boundary without aligning app capability gates would create an accidental SQL execution path. Treat capability and host authorization as part of the contract, not as optional call-site policy.
- Risk: raw credential fields in kernel descriptors can leak through `getConnection()`, logs, cache details, tests, or SDK docs. Remove secrets from the kernel-owned type.
- Risk: cache keys based on string concatenation can collide when connection IDs, SQL, or params contain delimiters. Use structured identity and exact invalidation.
- Risk: `JSON.stringify` is not a complete query-param contract. It can throw, reorder semantics can be surprising, and unsupported values can accidentally collapse to identical strings. Normalize and reject unsupported params before cache lookup.
- Risk: returning mutable cached arrays lets any consumer corrupt future cache hits. Enforce immutability or clone.
- Risk: result metadata currently exists inside `QueryCache` but is lost through `IQueryExecutor.getCachedResult()`. A cache hit must not silently drop columns/types needed by formula spills or UI display.
- Risk: completion events are currently inert. Once activated, event timing can drive recalculation or UI refreshes, so the event contract must be deterministic and disposal-safe.
- Risk: docs currently mention QueryRequest interception, but source evidence does not show a real marker path. Either implement that path or correct the docs/comments.
- Edge cases: empty result sets with known columns, zero-column results, truncation at exactly max rows, provider total row counts, duplicate connection names from resolver/local registry, connection ID rename/reuse, provider timeout after dispose, concurrent refresh plus cache hit, manual invalidation during in-flight execution, and cache capacity one.
- Non-goal: adding native database drivers or network fetches to kernel.
- Non-goal: optimizing a test-only query harness.
- Non-goal: preserving stale skipped tests as documentation. They should become active provider-boundary tests or be removed.
- Non-goal: compatibility shims for a known-wrong `unknown` service contract. With no external users, update the contract and call sites directly.

## Parallelization notes and dependencies on other folders, if any

This work decomposes cleanly once the execution boundary contract is written:

- Contract worker: define query descriptors, provider request/result/error types, cache policy, and public service contract alignment in `kernel/src/services/query-executor/types.ts`, `types/api/src/services/index.ts`, and relevant contracts/API snapshot files.
- Service worker: implement provider injection, `executeQuery()` pipeline, in-flight dedupe, lifecycle guards, and active executor tests in `kernel/src/services/query-executor`.
- Cache worker: replace key generation and cache entry storage, add immutability/exact invalidation/capacity behavior, and update cache tests.
- Capability worker: audit and adapt `kernel/src/api/app/capability-gated/scoped-connections-api.ts` so any shared provider still enforces `connections:read` versus `connections:native`.
- Formula worker: investigate and, if in scope, implement the real QUERY/CONN marker path across compute/kernel/workbook APIs.
- Docs/security worker: update foundations and data-flow docs to match the final default-egress and host-provider contract.

Dependencies:

- Provider execution cannot be implemented correctly until the result/error/cache contract is specified.
- Public service contract updates affect API snapshots and possibly package export policy.
- Formula integration depends on the compute formula implementation and should not be inferred from stale comments alone.
- The app connections capability boundary must remain separate unless an explicit adapter contract is introduced.
