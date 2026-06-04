# 084 — Improve `mog/kernel/src/services/query-executor` (query execution service boundary & result behavior)

## Source folder and scope

- **Folder:** `mog/kernel/src/services/query-executor`
- **Files in scope (4 source + 2 tests, ~1,786 lines total):**
  - `index.ts` (22 lines) — barrel re-exporting `QueryCache`, `buildCacheKey`, `createQueryExecutor`, and the public types.
  - `query-executor.ts` (279 lines) — `QueryExecutor` class + `createQueryExecutor` factory: connection registry, optional `IConnectionResolver`, LRU cache plumbing, a `query:complete` event emitter, and `executeQuery`.
  - `query-cache.ts` (199 lines) — `QueryCache` LRU + `buildCacheKey` string-key builder.
  - `types.ts` (291 lines) — `ConnectionConfig`, `DatabaseType`, `IConnectionResolver`, `QueryResult`, `QueryError`/`QueryErrorType`, `QueryCacheEntry`, `QueryCompleteEvent`/`QueryCompleteCallback`, and the `IQueryExecutor` interface.
  - `__tests__/query-cache.test.ts` (≈9.5 KB) and `__tests__/query-executor.test.ts` (≈21 KB).
- **Out of scope (named only for coupling, not edit targets):**
  - `mog/kernel/src/context/kernel-context.ts:48,329,406` — constructs and disposes the service (`createQueryExecutor()` in `IKernelServices`).
  - `mog/kernel/src/services/index.ts:162,168–175` — re-exports the service from the services barrel.
  - `@mog-sdk/contracts/core` (`CellValue`, `IDisposable`), `@mog/spreadsheet-utils/disposable` (`CallableDisposable`), and `../primitives` (`Result`, `ok`, `err`, `TypedEventEmitter`).

## Current role of this folder in Mog

This folder is the **kernel-side service boundary for external database query execution**. Its declared architecture (header comment in `query-executor.ts:1–19`) is:

> Calculator (pure) returns a `QueryRequest` marker → Kernel/QueryExecutor intercepts the marker during recalculation → checks the cache → on miss executes against a database connection → emits `query:complete` to trigger re-evaluation of dependent cells.

The service is instantiated once per document (`kernel-context.ts:329`) and lives as a cross-app kernel service surviving app switches. It owns three concerns: a **connection registry** (name → `ConnectionConfig`, with an optional external `IConnectionResolver` fallback), an **LRU result cache** keyed by `connectionId|sql|params`, and an **event channel** (`onQueryComplete`) intended to drive recalculation of cells that depend on a completed query.

## Evidence (observed in the current tree)

The service boundary is **half-disconnected from production**: the connection/cache/event plumbing is intact, but the actual execution path and the recalc integration it describes do not exist. Concrete findings:

1. **`executeQuery` is a permanent stub — the entire execution path is dead.** `query-executor.ts:163–187` validates the connection name, then unconditionally `void`s `connection`/`sql`/`params` and returns `err('execution_error', 'Database query execution has been removed from this build.')`. There is no transport, no async I/O, no timeout, no cancellation. The header comment (line 17) confirms it: "Unsupported until a production database boundary is reintroduced."

2. **The `query:complete` event channel is unreachable in production.** `emitQueryComplete` (`query-executor.ts:241–247`) is `private` and is **never called** anywhere — because the only caller would be a successful `executeQuery`, which never succeeds. `onQueryComplete` (line 233) is part of `IQueryExecutor` but a repo-wide search finds **no consumer** subscribing to it. The described "re-evaluate dependent cells on completion" flow is not wired.

3. **No `QueryRequest` marker exists.** The architecture comment says the calculator returns `QueryRequest` markers that the executor intercepts during recalc. A repo-wide search for `QueryRequest` finds **only the comment in this file** — no marker type, no calculator emission, no interception site. The recalc-integration contract is documentation-only.

4. **The service is constructed but never used.** `kernel-context.ts:329` creates `queryExecutor` and `:406` disposes it; no code path calls `executeQuery`, `registerConnection`, `getCachedResult`, `setCachedResult`, or `onQueryComplete` outside the folder's own tests. `setConnectionResolver` exists for a `ConnectionManager` that does not exist in the tree (`grep ConnectionManager` → only the comment at `query-executor.ts:84`).

5. **Cache has no TTL / staleness model.** `QueryCacheEntry.cachedAt` is written (`query-cache.ts:90`) but **never read**. There is no expiry, no max-age, no freshness check. For a database-backed cache this is a correctness hazard: once the execution path is live, a cached result is served forever until manual `invalidateCache` or LRU eviction, even though the underlying table has changed.

6. **Cache capacity is entry-count, not byte-bounded.** `QueryCache` evicts when `size >= capacity` entries (`query-cache.ts:80`). Each entry is a `CellValue[][]` of arbitrary size; 100 large result sets can hold unbounded memory. No row-count cap is enforced on stored results (and `QueryResult.truncated`/`rowCount` are declared in `types.ts:83,89` but never produced).

7. **Result metadata is write-only / unreachable through the public interface.** `setCachedResult` stores `columnNames`/`columnTypes` into the entry (`query-executor.ts:197–203`, `query-cache.ts:87–93`), but the only public read accessor `getCachedResult` returns just `entry.result` (`query-executor.ts:193–195`). `QueryCache.getEntry` exposes metadata but is **not** on `IQueryExecutor`, so consumers can never retrieve column names/types they cached.

8. **`buildCacheKey` uses raw `JSON.stringify(params)` and embeds full SQL.** `query-cache.ts:186–198`. `JSON.stringify` is order-sensitive for object params (`{a,b}` ≠ `{b,a}` → cache misses) and conflates `undefined`/`[]` (both → `''`). The full untruncated SQL is embedded in the key, so keys for large generated queries are large. There is no real hash despite the docstring saying "simple hash."

9. **Two coexisting error/result conventions.** Execution returns `Result<QueryResult, QueryError>` (`primitives` Result), yet `QueryResult` *also* carries `success: boolean` and `error?: string` (`types.ts:74–87`). A failure can be expressed two ways (`err(QueryError)` vs `ok({success:false,error})`), and `QueryError.details` is an open `Record<string, unknown>` that can carry connection internals into logs.

10. **Reconfigure does not invalidate stale cache.** `removeConnection` correctly invalidates by resolved `connection.id` (`query-executor.ts:149–157`). But `registerConnection` (line 126) overwrites a same-named connection without invalidating cache entries keyed by the previous `id` — a re-pointed connection can serve results from the old target.

11. **Declared error taxonomy is unused.** `QueryErrorType` enumerates `connection_error | network_error | timeout | invalid_sql` (`types.ts:95–101`), but only `connection_not_found` and `execution_error` are ever produced. The timeout/network/SQL-validation paths that would emit the others do not exist.

## Improvement objectives

The directive is the **right production-path improvement**, not a reduced-scope or shim fix. The boundary today claims a capability ("query execution") that it does not provide and wires an event/recalc contract that is absent. The production-correct outcome is to **make the boundary a real, pluggable execution seam again** with sound result behavior, and to make the marker→recalc contract it documents actually exist. Objectives:

1. **Restore a real execution path behind a transport seam.** Introduce an `IQueryTransport` (host-supplied async backend) that `executeQuery` delegates to. The kernel service owns connection resolution, caching, single-flight, error mapping, and event emission; the *transport* owns the actual network/database I/O. When no transport is registered, `executeQuery` returns a typed `unsupported`/`connection_error` — not a hard-coded "removed from this build" string baked into the only code path.
2. **Implement the documented marker→recalc contract.** Define the `QueryRequest` marker type and the interception/emit cycle so a completed query emits `query:complete` and drives re-evaluation of dependent cells — or, if the product decision is that markers are not reintroduced now, remove the dead event channel and stub from the public surface so the boundary stops advertising behavior it cannot deliver. (See Risks for the decision gate.)
3. **Make result behavior correct and bounded:** TTL/staleness, byte/row bounds on cached results, deterministic cache keys, single-flight de-duplication, and timeout/cancellation honoring the existing `QueryErrorType` taxonomy.
4. **Unify the error/result model** on `Result<QueryResult, QueryError>` and stop leaking connection internals through `details`.
5. **Expose cached metadata** (column names/types) through `IQueryExecutor`, or drop it from the cache entry — no write-only fields.

## Production-path contracts and invariants to preserve or strengthen

- **`IQueryExecutor` is the kernel service contract.** It is re-exported through `services/index.ts` and consumed via `IKernelServices`. Any signature change must keep `kernel-context.ts` compiling and keep `dispose()`/`[Symbol.dispose]()` semantics (clear connections, cache, events).
- **Cache key stability across process runs is required** for the cache to be meaningful — strengthen determinism (canonicalized params, stable hashing) without changing the `connectionId|...` namespacing that `invalidateByPrefix` relies on (`query-cache.ts:133–143`).
- **Connection-scoped invalidation invariant:** every mutation of a connection's identity/target (`removeConnection` *and* `registerConnection` overwrite, and any resolver change via `setConnectionResolver`) must invalidate cache entries for the affected `connectionId`. Preserve the existing correct `removeConnection` behavior; extend it to the overwrite path.
- **No-lowercase-SQL invariant** (`query-cache.ts:188–191`): SQL must not be case-folded for keying (would corrupt string literals / case-sensitive DBs). Keep this.
- **Purity boundary:** the calculator stays pure; only the kernel/executor performs I/O. Any marker-interception change must not move I/O into the calculator.
- **Disposal invariant:** after `dispose()`, no event fires and no transport call is in flight (cancel outstanding queries on dispose).
- **Secret handling:** `ConnectionConfig.password` and `QueryError.details` must never be logged or surfaced through events/errors verbatim.

## Concrete implementation plan

Steps are ordered so each is independently reviewable; early steps are safe even if the marker decision (Step 5) is deferred.

1. **Introduce the transport seam (`query-transport.ts`, new file in this folder).**
   - Define `interface IQueryTransport { execute(connection: ConnectionConfig, sql: string, params: unknown[], opts: { signal?: AbortSignal; timeoutMs?: number; maxRows?: number }): Promise<QueryResult>; }`.
   - Add `setQueryTransport(transport: IQueryTransport | undefined)` to `IQueryExecutor` (mirrors `setConnectionResolver`), so the host wires a real backend after construction.
   - Rewrite `executeQuery` to: resolve connection (preserve current `connection_not_found` branch) → build cache key → **single-flight** check (Step 4) → cache check with TTL (Step 3) → if no transport, return `err('connection_error', 'No query transport registered')` (typed, not a build-time string) → else `await transport.execute(...)` inside try/catch that maps thrown/`AbortError`/timeout to the correct `QueryErrorType`.

2. **Unify the error/result model (`types.ts`, `query-executor.ts`).**
   - Make `QueryResult` represent only a *successful* payload (`data`, `columnNames`, `columnTypes`, `rowCount`, `executionTimeMs`, `truncated`); remove the redundant `success`/`error` fields, since failure flows through `Result.err(QueryError)`.
   - Narrow `QueryError.details` to a closed, non-secret shape (e.g. `{ connectionName?: string; code?: string }`); never include host/password/sql.
   - Add an error-mapping helper that classifies transport failures into `timeout | network_error | invalid_sql | connection_error | execution_error`.

3. **Add TTL / staleness to the cache (`query-cache.ts`, `types.ts`).**
   - Add a `ttlMs` option (per-executor, optionally per-`set`); on `get`/`getEntry`, treat entries older than `now - cachedAt > ttlMs` as a miss (delete + count as miss). This is why `cachedAt` exists; wire it.
   - Thread a clock so tests are deterministic (inject `now()` rather than calling `Date.now()` directly in `set`/`get`), keeping the public default behavior unchanged.
   - Enforce a `maxRows`/byte bound: refuse to cache (or mark `truncated`) results above a configured size so the LRU cannot hold unbounded memory.

4. **Add single-flight de-duplication (`query-executor.ts`).**
   - Maintain `Map<cacheKey, Promise<Result<...>>>` of in-flight executions; concurrent identical requests share one transport call. Clear the entry on settle. This prevents duplicate database load and duplicate `query:complete` emissions during a recalc storm.

5. **Resolve and implement the marker→recalc contract (decision gate — see Risks).**
   - **If reinstating:** define `QueryRequest` (connection name, sql, params) as a calculator marker type in the contracts/calculator layer (cross-folder; see Parallelization), have the kernel intercept markers during recalc, call `executeQuery`, `setCachedResult` on success, and call `emitQueryComplete` (promote it from dead-private to the real success callback) so subscribers re-evaluate dependents. Wire one subscriber in `kernel-context` that requests recalc of the dependent range.
   - **If not reinstating now:** delete the unreachable `query:complete` channel (`onQueryComplete`, `QueryCompleteEvent`, the `QueryEventEmitter` subclass) and the architecture comment's marker claims, so `IQueryExecutor` advertises only what it delivers. (This is removal of dead surface, not a scope reduction of the execution path.)

6. **Fix cache-key determinism & connection invalidation (`query-cache.ts`, `query-executor.ts`).**
   - Canonicalize `params` (stable key ordering for object params; distinguish `undefined` from `[]`) before serialization; hash the SQL portion so keys are bounded in size while keeping the `connectionId|` prefix intact for `invalidateByPrefix`.
   - In `registerConnection`, when overwriting an existing name whose resolved `id` differs (or unconditionally on overwrite), `invalidateCache(oldId)`. In `setConnectionResolver`, invalidate affected entries when the resolver changes connection identity.

7. **Expose metadata through the interface (`types.ts`, `query-executor.ts`).**
   - Add `getCachedEntry(cacheKey): QueryCacheEntry | undefined` to `IQueryExecutor` (delegating to `QueryCache.getEntry`) so cached `columnNames`/`columnTypes` are retrievable, or remove those fields from the entry if they have no consumer after Step 5.

8. **Honor timeout/cancellation in `dispose` and per-query (`query-executor.ts`).**
   - Hold an `AbortController` per in-flight query; `dispose()` aborts all, clears the single-flight map, then clears connections/cache/events. Guarantee no `query:complete` fires after dispose.

9. **Refresh the header/architecture comments** to match the implemented reality (transport seam, TTL, single-flight, and the actual marker decision from Step 5).

## Tests and verification gates

> Per task constraints this plan does not run build/test commands; the gates below are the acceptance criteria for the implementing change.

- **Unit — cache (`query-cache.test.ts`):** add TTL expiry (entry served fresh, then a miss after `ttlMs` via injected clock), byte/row-bound refusal, deterministic key for reordered object params, `undefined` vs `[]` distinction, and key-size bound for large SQL. Keep existing LRU/eviction/prefix-invalidation tests green.
- **Unit — executor (`query-executor.test.ts`):**
  - No transport → `executeQuery` returns typed `connection_error` (not the old "removed from this build" string).
  - With a mock `IQueryTransport`: success path caches result, emits `query:complete` exactly once, and serves the second identical call from cache (no second transport call).
  - **Single-flight:** two concurrent identical calls invoke the transport once and both resolve.
  - **Error mapping:** transport timeout → `timeout`; thrown network error → `network_error`; rejected SQL → `invalid_sql`.
  - **Invalidation:** `registerConnection` overwrite and `removeConnection` both evict cache for the prior `id`; resolver change invalidates affected entries.
  - **Dispose:** in-flight query is aborted and no `query:complete` fires post-dispose.
  - **Metadata:** `getCachedEntry` returns the stored `columnNames`/`columnTypes`.
- **Integration (if Step 5 reinstates markers):** a sheet with a `QueryRequest`-producing cell recalculates dependents after `query:complete`; covered by an existing kernel recalc harness (cross-folder).
- **Gates:** `pnpm --filter @mog/kernel typecheck`, the kernel unit suite, and `@mog-sdk/contracts` declaration rollup if any contract type moves (see memory: contracts declaration rollup). Lint/import-boundary plugin must stay green (transport interface stays kernel-internal unless a contracts type is required).

## Risks, edge cases, and non-goals

- **Primary risk — product direction is undecided.** The "removed from this build" stub (finding #1) may be an intentional product state, not a bug. Step 5 is a **decision gate**: reinstating the execution path + markers is the full production improvement; if product confirms queries are permanently gone, the right production move is to *remove the dead surface* (event channel, stub, marker comments) rather than leave a boundary advertising phantom behavior. Both branches are production-correct; a shim that keeps the stub while pretending to support execution is not. **Confirm direction before Step 1/5.**
- **Cache correctness vs. staleness:** TTL trades freshness for load; default `ttlMs` must be conservative and overridable per connection. Without markers (Step 5 deferred), `query:complete` recalc cannot be exercised end-to-end — flag that the event tests use a mock.
- **Edge cases:** zero-row results vs. cache-miss ambiguity (cache an empty `[][]` distinctly from "absent"); params containing non-serializable values (functions, BigInt) must fail key-building loudly, not silently collide; concurrent dispose during in-flight query.
- **Security:** never log/emit `password` or raw `details`; ensure single-flight map keys (which embed sql) are not exposed in errors.
- **Non-goals:** writing a concrete database driver (that is the host transport's job, outside the kernel); adding new `DatabaseType`s; changing the calculator's purity model; UI/connection-management surfaces; performance tuning beyond the bounded-cache and single-flight changes here.

## Parallelization notes and dependencies on other folders

- **Self-contained for Steps 1–4, 6–9:** all edits stay within `query-executor/` plus its tests; no other folder changes. These can proceed in parallel with other service reviews.
- **Step 5 (marker reinstatement) is cross-folder and serialized after a product decision:**
  - `QueryRequest` marker likely belongs in `@mog-sdk/contracts/*` and/or the calculator/engine (`mog/engine/src`), and the interception site is in the kernel recalc loop — coordinate with the owners of those folders. Touching contracts triggers the **declaration rollup** (`pnpm --filter @mog-sdk/contracts build`) before kernel typecheck (see memory).
- **`setQueryTransport` consumer:** the host that supplies `IQueryTransport` lives outside this folder (`kernel-context` wiring + an OS/app boundary). Adding the method to `IQueryExecutor` is safe (additive); wiring a real transport is a follow-up owned by the host layer.
- **Light coupling:** `kernel-context.ts` and `services/index.ts` only need recompilation against the widened `IQueryExecutor`; no behavioral change there unless a transport is wired.
