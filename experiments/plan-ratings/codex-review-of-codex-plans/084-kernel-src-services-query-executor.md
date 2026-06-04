Rating: 8/10

Summary judgment

This is a strong, evidence-based plan for turning `query-executor` from a mostly inert registry/cache stub into a real service boundary without weakening Mog's default no-egress posture. It correctly identifies the current production behavior: per-document service creation/disposal, resolver precedence, delimiter-based cache keys, credential-shaped local configs, mutable cached arrays, weak `types/api` service typing, no production `executeQuery()` caller, and skipped execution/event tests. The plan's architectural direction is right: kernel owns descriptors, request/result/cache semantics, and lifecycle; host/provider code owns credentials, authorization, and network/database execution.

The rating is not higher because the plan is broader than its executable contract. It specifies many good invariants, but it does not fully resolve where the canonical public contract should live across `kernel`, `types/api`, `contracts`, and `types/connections`, nor does it split the work into hard phase gates that prevent a partial provider pipeline from shipping with ambiguous public API or capability semantics.

Major strengths

- Preserves the critical security boundary: no native database drivers, fetch, transport, or default egress inside `kernel/src/services/query-executor`.
- Correctly reframes execution as a host-supplied provider port rather than resurrecting the skipped bridge-backed tests.
- Gives concrete cache requirements: structured identity, exact connection-id invalidation, metadata-preserving entries, canonical params, capacity validation, and immutability.
- Treats result/error shape as a real contract by moving away from `QueryResult.success = false` toward `Result<QueryExecutionSuccess, QueryExecutionError>`.
- Includes lifecycle and concurrency behavior that would otherwise be easy to miss: in-flight dedupe, dispose guards, late provider completion suppression, and event timing.
- Explicitly checks the app-facing capability boundary, especially `connections:read` versus `connections:native`, instead of letting `services.queryExecutor` become an unrestricted SQL path.
- Calls out stale QUERY/CONN marker comments and requires either real formula integration or documentation cleanup.
- Verification coverage is substantial and production-path oriented, including active provider-boundary tests, cache tests, API snapshot checks, capability tests, and UI/E2E requirements if formula workflows are implemented.

Major gaps or risks

- The canonical type ownership is unresolved. The plan says `types/api/src/services/index.ts` should reference the real query-executor contract types or mark the service internal, but it does not decide whether those types belong in `contracts`, `types/connections`, a new public package surface, or kernel-private exports. Importing kernel service types into public API types may violate package direction or publish boundaries.
- The migration is too large for one implementation slice. Provider injection, cache redesign, public service typing, capability adapter policy, docs, and optional formula integration are separate contracts. Without explicit phase boundaries, a worker could partially implement execution while leaving public API or security docs inconsistent.
- The provider authorization contract remains vague. The plan says the service should accept an already-authorized host/provider context or require caller context, but does not define the shape, lifecycle, or enforcement point for that context.
- Parameter normalization is directionally good but underspecified. It lists rejected values and stable ordering, but should define the exact accepted JSON/cell-value grammar, date/error handling, equality semantics for `undefined` versus omitted params, and how provider-specific parameters are intentionally excluded.
- Result normalization needs a sharper rectangularity contract. The plan says `CellValue[][]`, row counts, and column metadata length must match, but it should define behavior for zero-column rows, empty result sets with headers, ragged provider rows, duplicate column names, and unsupported cell values.
- The event contract may be too narrow for downstream recomputation. Defaulting `query:complete` to fresh successful cache commits is reasonable, but formula integration may also need invalidation, refresh-start, or error observability. The plan should decide before any formula path depends on events.
- It does not explicitly handle compatibility for existing manual cache methods. `getCachedResult()` and `setCachedResult()` are currently public through `IQueryExecutor`; if they remain, the plan should define whether they are deprecated, narrowed, renamed, or kept as test/support hooks.
- Verification commands are mostly right, but the plan should map each phase to its minimal required gates so workers do not run broad checks for cache-only changes or skip API/publish checks after public type/export changes.

Contract and verification assessment

The contract assessment is the strongest part of the plan. It identifies the current weak contracts and replaces them with verifiable invariants around provider ownership, no default egress, typed errors, cache identity, metadata preservation, immutable reads, resolver precedence, event semantics, disposal safety, and capability separation. Those are the right production contracts for this folder.

The verification plan is also strong. Converting skipped tests into active fake-provider tests is essential, and the cache test list directly targets real failure modes in the current implementation. The plan also correctly requires capability-gated API tests if the app connections boundary is touched and real UI input paths only if QUERY formula integration is implemented.

The main verification weakness is sequencing. The plan should say which tests must fail first for each contract, which package owns type/snapshot verification, and which gates are mandatory per phase. It should also add explicit security regression checks for "no provider means no execution and no egress" and for "query executor provider cannot bypass `connections:native` when raw SQL is exposed through app APIs."

Concrete changes that would raise the rating

- Add a phase plan with hard acceptance criteria: cache/key contract first, service/provider contract second, public type/API alignment third, capability adapter fourth, formula integration only if explicitly in scope.
- Decide the canonical type package and dependency direction before implementation. If query execution contracts are public, place them in an appropriate contracts/types package; if internal, keep `types/api` narrow and document that `IKernelServices.queryExecutor` is infrastructure-only.
- Specify exact TypeScript shapes for `QueryExecutionProvider`, provider context, cache policy, normalized params, success result, and error union, including readonly/clone/freeze policy.
- Define authorization and capability flow for host providers, including who supplies caller context and how raw/native SQL is prevented from bypassing `createScopedConnectionsAPI()`.
- Add migration rules for existing `ConnectionConfig`, `getCachedResult()`, `setCachedResult()`, `buildCacheKey()`, and public exports so implementers know what breaks intentionally.
- Convert the broad verification list into phase-specific gates, with API snapshot/publish checks tied only to public surface changes and capability tests tied to app boundary changes.
