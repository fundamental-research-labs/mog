Rating: 8/10

Summary judgment

This is a strong plan: it reads the current `query-executor` folder accurately, identifies the production-path disconnect, and proposes a real service-boundary repair instead of papering over the stub. The evidence matches the source: `executeQuery` validates the connection then always returns the removed-from-build error, `emitQueryComplete` is private and unreachable, `QueryRequest` only exists in comments, cache metadata is not exposed through `IQueryExecutor`, and the cache has no TTL or size bound. The plan also correctly treats this as a kernel boundary issue, not a place to embed concrete database drivers.

The score is not higher because the plan still has an unresolved product-direction fork at the center of the work. It says to confirm whether query execution should be reintroduced, but then most of the implementation plan assumes the reintroduction path. A plan this broad should make the decision artifact, owner, and acceptance criteria explicit before proposing interface additions. It also contains at least one concrete verification mismatch: the kernel package is `@mog-sdk/kernel`, not `@mog/kernel`.

Major strengths

- Excellent source-grounded findings. The plan calls out the exact stub behavior, unused event channel, missing marker type, construction-only service usage, write-only metadata, weak cache keying, and stale-cache invalidation gaps.
- Architecturally appropriate transport boundary. Keeping the kernel responsible for resolution, cache policy, single-flight, error mapping, and events while pushing real database I/O behind a host-supplied `IQueryTransport` is the right dependency direction.
- Good attention to result semantics. Unifying failures under `Result<QueryResult, QueryError>` and making `QueryResult` a success payload would remove a real double-failure convention.
- Strong cache correctness instincts: TTL, deterministic param serialization, bounded key size, connection-scoped invalidation on overwrite, and row/byte limits are all relevant once execution becomes real.
- Verification coverage is broad and behavior-oriented, especially around single-flight, event emission count, error mapping, resolver invalidation, metadata, and dispose behavior.

Major gaps or risks

- The product decision is still too loosely specified. If native/external query execution was intentionally removed, the implementation branch that adds `IQueryTransport` and marker recalc is not just "deferred"; it may be the wrong public contract. The plan should require a named decision record or explicit owner approval before adding surface area.
- Step 5 is the hardest part and the least contractually concrete. "Wire one subscriber in `kernel-context` that requests recalc of the dependent range" does not specify how dependencies are represented, how a cell is associated with a `cacheKey`, what happens to stale dependents, or how repeated query completion avoids recalc loops.
- The proposed `IQueryTransport` contract is under-specified for a host boundary. It needs clearer guarantees around param serialization, supported `CellValue` conversions, `columnTypes` vocabulary, timeout ownership, truncation semantics, and whether `execute` may return `QueryResult` with `truncated` already applied.
- Cache bounds are directionally right but not acceptance-ready. "Byte bound" needs a deterministic estimator or explicit measured unit; otherwise implementations can disagree and tests become arbitrary.
- The plan recommends narrowing `QueryError.details` but does not define the final error envelope tightly enough. It should specify exact allowed fields and redaction behavior for SQL, params, host, username, and password.
- The cache lookup ordering says single-flight check before TTL cache check. That may be acceptable, but the intended invariant should be spelled out: fresh cache should not wait on a concurrent transport call, and stale cache should not be served while a refresh is in flight unless stale-while-revalidate is explicitly chosen.

Contract and verification assessment

The contract assessment is mostly solid. It names `IQueryExecutor` as the service contract, preserves calculator purity, keeps the connection-id cache prefix invariant, and recognizes disposal and secret-handling obligations. The plan also correctly notes that moving a marker into contracts/calculator layers would trigger cross-package verification.

The verification section is good but needs tightening. The package gate should be `pnpm --filter @mog-sdk/kernel typecheck`, matching `mog/kernel/package.json`. The test gate should name the exact kernel unit command or focused Jest path, not just "the kernel unit suite." If contracts are touched, the plan should specify the actual contracts package gate and declaration/public-type gate expected by this repo. The integration test for marker-driven recalc also needs a stronger production-path requirement: it must prove the actual recalc/dependency path, not just subscribe directly to `onQueryComplete`.

Concrete changes that would raise the rating

1. Add an explicit decision gate document: either "queries are returning" with transport and marker acceptance criteria, or "queries are retired" with dead-surface removal acceptance criteria.
2. Specify the `QueryRequest` lifecycle end to end: marker shape, cache key derivation, dependency registration, async completion, recalc scheduling, loop prevention, and behavior on failure/timeout/dispose.
3. Define the exact `IQueryTransport` and `QueryResult` contracts, including type conversion, truncation, timeout/cancellation, metadata vocabulary, and host redaction rules.
4. Replace vague cache bounds with concrete policies: default TTL, max rows, max stored cells or bytes, oversized-result handling, and deterministic size estimation for tests.
5. Correct the verification gates to `@mog-sdk/kernel`, name the focused test command/path, and add the precise contracts build/type gate if public contract types move.
