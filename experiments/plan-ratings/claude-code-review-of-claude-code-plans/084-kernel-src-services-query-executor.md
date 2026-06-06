Rating: 7/10

# Review — 084 `mog/kernel/src/services/query-executor`


## Summary judgment

This is a strong, evidence-dense plan that correctly diagnoses the central
reality of the folder: the query-execution boundary advertises a capability it
no longer delivers. The in-folder forensic work is excellent and almost entirely
verifiable against the tree — findings #1, #2, #4, #5, #6, #7, #8, #9, #10, and
#11 all check out at the cited line numbers. The improvement objectives are the
right production-path moves (real transport seam, unified error model, bounded
cache with TTL, single-flight, deterministic keys), and the contract/invariant
section is genuinely good.

What keeps this out of the 8–9 band is a material factual error at the hinge of
its most consequential step. Finding #3 asserts that a repo-wide search for
`QueryRequest` "finds only the comment in this file — no marker type." That is
wrong. `types/connections/src/query.ts:185` defines `QueryRequest`
(`{ __queryRequest__: true; connection; sql; params }`) — exactly the marker the
architecture comment describes — alongside `QueryErrorMarker`, `ConnectionRef`,
`QueryParameter`, `QueryStatus`, and `QueryFormulaResult`. An entire dormant
contracts module modeling this domain was missed. This isn't cosmetic: it
changes the true state from "the marker contract is documentation-only" to "the
marker contract is *designed in contracts but not wired*," and it directly
undermines Step 5, which instructs the implementer to *define* `QueryRequest`
anew — risking a duplicate type and ignoring the existing `QueryFormulaResult`
result-lifecycle type that any recalc design must reconcile with.

## Major strengths

- **Verifiable, line-anchored evidence.** Nearly every claim cites a specific
  location and holds up: the `void connection/sql/params` stub
  (`query-executor.ts:178–186`), the dead-private `emitQueryComplete`
  (`:241`) with no runtime subscriber (only `types/api/src/services/index.ts:321`
  declares the interface shape), `cachedAt` written but never read
  (`query-cache.ts:90`), entry-count-not-byte capacity (`:80`), write-only
  metadata unreachable via `IQueryExecutor`, and the dual `Result` /
  `success:boolean` error conventions (`types.ts:74–101`). This is the kind of
  grounding that makes a plan trustworthy.
- **Correct production framing.** It explicitly rejects a shim and frames the
  work as restoring a real, pluggable seam — the `IQueryTransport` design (host
  owns I/O, kernel owns resolution/cache/single-flight/error-mapping/events) is
  clean and respects the stated purity boundary.
- **Excellent invariant section.** No-lowercase-SQL, connection-scoped
  invalidation (and the correct observation that `removeConnection` invalidates
  but `registerConnection` overwrite does not), disposal/no-event-after-dispose,
  and secret handling for `password`/`details` are precisely the things that
  would break silently.
- **A real decision gate.** Recognizing that the "removed from this build" stub
  may be an intentional product state — and that *removing dead surface* is as
  production-correct as reinstating execution — is mature and avoids the trap of
  rebuilding something the product killed on purpose.
- **Test matrix maps to findings.** TTL expiry via injected clock, single-flight
  one-transport-call, error-type mapping, overwrite/resolver invalidation,
  dispose-abort, and metadata retrieval each trace back to a specific defect.

## Major gaps or risks

- **Finding #3 is false; Step 5 inherits the error.** `QueryRequest` already
  exists in `types/connections/src/query.ts`. Step 5 should *wire the existing
  marker and its siblings* (`QueryErrorMarker`, `QueryFormulaResult`,
  `ConnectionRef`, `QueryParameter`), not define a new type. The plan also never
  reconciles its `QueryResult` (the proxy shape it proposes to slim down) with
  the already-defined `QueryFormulaResult` (status-lifecycle shape) — the file
  comment in `query.ts` explicitly flags these two as distinct-but-related, which
  is exactly the contract reconciliation Step 2/5 must own. Missing this means
  the cross-folder step is under-specified in the one area that matters most.
- **The hard part of marker→recalc is hand-waved.** "Wire one subscriber in
  `kernel-context` that requests recalc of the dependent range" omits the actual
  difficulty: mapping a completed `cacheKey` back to the set of dependent cells,
  and which recalc/dependency-graph API drives that. Without naming the
  interception site in the recalc loop and the cacheKey→dependents mapping, Step
  5 is a wish, not a plan.
- **No investigation of *why* execution was removed.** The decision gate says
  "confirm direction," but the cheapest disambiguator — `git log`/blame on the
  removal commit and the dormant `types/connections` contracts — is not proposed.
  That history likely already answers whether markers are coming back.
- **Cache memory bound is named but not specified.** "byte/row bound" is an
  objective and a test, but no concrete cap, measurement strategy
  (`CellValue[][]` is not trivially sized), or default is given. Same for
  default `ttlMs` — called "conservative and overridable" without a number.

## Contract and verification assessment

The contract direction is sound: keep `IQueryExecutor` compiling against
`kernel-context.ts:48,329,406` and `services/index.ts`, additive
`setQueryTransport`/`getCachedEntry`, preserve the `connectionId|` prefix that
`invalidateByPrefix` depends on. The plan also correctly notes that any contract
type movement triggers the declaration rollup. The weakness is that the contract
surface it proposes to *add* partly already exists in `types/connections`, so
the plan should be reframed around aligning kernel types with that module rather
than inventing parallel ones — otherwise the "two coexisting conventions"
problem it rightly flags (#9) gets a third sibling.

Verification gates are appropriately scoped (typecheck + kernel unit suite +
rollup-if-contracts-move, lint/import-boundary green) and honestly acknowledge
that without markers the `query:complete` recalc path can only be exercised with
a mock. The test list is the strongest part of the back half.

## Concrete changes that would raise the rating

1. **Correct finding #3** and re-author Step 5 around the *existing*
   `types/connections/src/query.ts` contracts: reuse `QueryRequest` /
   `QueryErrorMarker`, and explicitly reconcile `QueryResult` vs
   `QueryFormulaResult` (which is canonical, which derives from which).
2. **Specify the marker→recalc mechanics**: name the interception site in the
   kernel recalc loop, the API used to request dependent recalc, and how a
   settled `cacheKey` resolves to its dependent cells.
3. **Add a git-history check** to the decision gate (the removal commit + the
   dormant contracts module) before choosing reinstate-vs-remove.
4. **Put numbers on the bounds**: a default `ttlMs`, a concrete max-rows/byte cap
   and how result size is estimated, so the cache tests have a fixed target.
5. **State the migration of the `success`/`error` fields** for any external
   consumer of `QueryResult` (the `types/api` mirror) so the type-slimming in
   Step 2 doesn't silently break the API interface surface.
