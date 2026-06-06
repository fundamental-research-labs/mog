Rating: 8/10

# Review: 084 — kernel/src/services/query-executor

## Summary judgment

This is a strong, evidence-grounded plan. I verified its factual claims against the source folder and every material assertion holds:

- `ConnectionConfig` carries raw `password`/`username` fields plus an `[key: string]: unknown` index signature (`types.ts:26-47`).
- `executeQuery()` resolves the connection, then unconditionally returns an `execution_error` "Database query execution has been removed from this build." (`query-executor.ts:163-187`).
- The cache key is plain delimiter concatenation `${connectionId}|${normalizedSql}|${paramsStr}` (`query-cache.ts:186-198`), and invalidation is `startsWith` prefix matching (`query-cache.ts:133-143`), so a connection ID that is a string prefix of another collides.
- `QueryCache.get()` returns the stored `entry.result` array by reference (`query-cache.ts:37-48`) — mutable cache exposure is real.
- `emitQueryComplete()` is private and has no caller; there is no success path (`query-executor.ts:241-247`).
- `types/api/src/services/index.ts:286-325` types `IQueryExecutor` almost entirely with `unknown` — the "weak public contract" claim is accurate.
- `createDocumentContext()` wires `queryExecutor: createQueryExecutor()` and disposes it (`kernel-context.ts:329,406`).
- The capability split (`connections:read` portable vs `connections:native` raw) is real (`scoped-connections-api.ts`).
- `DATA-FLOW-AND-EGRESS.md:42` confirms native DB execution is documented as removed/deployment-controlled.
- Skipped tests exist exactly as described: two `describe.skip` blocks and one `it.skip` for resolver-backed execution.
- No production caller of `executeQuery`/`registerConnection`/`onQueryComplete` outside tests — confirmed by grep.

The plan reads the code honestly, frames the correct production boundary (host-supplied execution port, no default egress), and refuses to over-reach into adding DB drivers to the kernel. The risk and test sections are unusually concrete and directly traceable to defects in the current code.

## Major strengths

- **Architectural fit is correct and security-aware.** The central thesis — kernel owns descriptors/cache/normalization/result contracts, host owns credentials/clients/auth/execution — preserves the documented no-default-egress posture rather than quietly reversing it. The explicit `execution_unavailable` vs generic `execution_error` distinction is the right contract refinement.
- **Defects are real, not invented.** Delimiter-collision keys, prefix-match invalidation, mutable cached arrays, credential-bearing kernel types, inert events, and the weak `unknown` `types/api` surface are all verifiable in the source. The plan does not pad with speculative problems.
- **Contract specificity.** The proposed `Result<QueryExecutionSuccess, QueryExecutionError>`, discriminated error taxonomy, descriptor-vs-config split, and rectangular-matrix/column-width invariants are precise enough to implement and test against.
- **Verification gates are executable and scoped** (`pnpm test -- src/services/query-executor`, typecheck at both levels, `check:api-snapshots`, `check:publish-readiness:fast`, capability-gated tests), with correct conditionality on what changed.
- **Intellectual honesty about the QUERY formula path.** It declines to assume a marker-interception flow that source doesn't support, and frames it as "investigate compute, then decide" with two explicit branches — rather than fabricating an integration.
- **Disposal/late-completion safety and in-flight dedupe** are called out as first-class invariants, which is exactly where async query services break.

## Major gaps or risks

- **Whether this rework is warranted at all is left open.** With zero production callers and docs stating execution is removed, the plan proposes a full production `executeQuery` pipeline (provider injection, dedupe, event timing, refresh policy). The plan acknowledges this via non-goals but never states the *trigger*: who the host-provider consumer is, which distribution needs it, or why now versus leaving the service as a typed stub. This is the main architectural-fit weakness — the plan risks building infrastructure for an unused service. A decision gate ("ship provider port only if X consumer exists; otherwise minimize to descriptor+cache+typed-unavailable and correct docs") would materially de-risk it.
- **Partial duplication of existing capability.** The plan says result metadata "is lost through `IQueryExecutor.getCachedResult()`" and proposes adding `getResultEntry()`. True at the interface level — but `QueryCache` already has `getEntry()` (`query-cache.ts:55-66`) that preserves metadata; the gap is only that the public interface doesn't expose it. The plan slightly overstates the work; the fix is largely surfacing an existing method, not new storage.
- **Some proposed surface is speculative.** `clock` injection, cache serializer hooks, `providerScope`, `totalRowCount`, `query:cache-invalidated` events — each is justified individually, but together they expand a stub service's API ahead of any consumer. Without a named consumer this is gold-plating; the plan should mark these as deferred-until-needed rather than part of the core deliverable.
- **Snapshot/export impact is described but not pinned.** It correctly flags that `types/api` and possible package-subpath changes touch API snapshots, but does not name the specific snapshot file(s) or the publish-readiness boundary that would move, so a worker can't pre-confirm blast radius.
- **Sequencing within the "Service worker" is under-specified.** Steps 1–7 are ordered, but cache rework (step 3/4) and pipeline (step 5) share the cache-entry shape; the plan should state that the entry-shape contract is frozen before both proceed in parallel, or they will conflict.

## Contract and verification assessment

The contract direction is sound and the strongest part of the plan: moving failures from `QueryResult.success = false` into `err`, removing secrets from kernel types, structured collision-resistant keys with exact ID-based invalidation, immutability policy on cache egress, and a closed error taxonomy. These are testable and the plan supplies matching test cases (connection_not_found, execution_unavailable, resolver precedence, metadata-preserving cache write, error-no-cache, dedupe, event-fires-once/not-on-hit/not-after-dispose, credential-rejection, prefix-collision isolation, immutability via returned references).

Verification gates are appropriate and correctly conditional. The one weakness is that the most expensive branch — QUERY formula E2E through real compute/UI paths — is gated behind an undecided "if implemented," so the plan cannot guarantee that branch is either done or explicitly cut. The capability-gate regression assertion (`connections:read` must not expose `executeNative`) is the right guardrail and matches the real code.

Net: contracts are clear and verification is mostly complete; the gap is a missing go/no-go decision gate that determines how much of the plan actually runs.

## Concrete changes that would raise the rating

1. **Add an explicit decision gate up front** (to 9): "Does any host/distribution need execution now?" If no → minimal track (descriptor split, typed `execution_unavailable`, structured keys, immutability, doc correction, activate no-provider test) and stop. If yes → name the consumer and proceed to the full pipeline. This resolves the central architectural-fit doubt.
2. **Correct the `getResultEntry` framing** to "expose existing `QueryCache.getEntry()` through the public interface" rather than implying new storage; reconcile with the metadata the cache already retains.
3. **Mark speculative surface (clock, serializer hooks, providerScope, totalRowCount, cache-invalidated event) as deferred-until-consumer-exists**, keeping the core deliverable tight.
4. **Pin the specific API snapshot file(s) and publish-readiness boundary** that the `types/api` retyping would move, so blast radius is pre-confirmed.
5. **State the cache-entry-shape freeze as an explicit cross-worker dependency** so Service and Cache workers don't race on the entry contract.
6. **Force a binary outcome on the QUERY formula branch** (implement-with-E2E or delete the misleading comments/skipped tests now) so no track is left half-specified.

## Scope confirmation

The only file created by this review is `mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/084-kernel-src-services-query-executor.md`. No production code, tests, fixtures, configs, or the reviewed plan were modified.
