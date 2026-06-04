Rating: 8/10

# Review of Plan 017 — Promote `mog/kernel/src/domain/pivots` to the canonical pivot domain layer


## Summary judgment

This is a strong, evidence-grounded plan. The author actually read the tree:
the central observations — that `domain/pivots/` contains only a 46-line
style-normalization helper while the real pivot domain behavior (≈2633 lines in
`api/worksheet/pivots.ts`, ≈1540 in `bridges/pivot-bridge.ts`) lives outside the
"domain" layer the `domain/README.md` charter says it should live in — are
correct and verifiable. Nearly every line citation checks out against the source
(verified below), and the plan correctly diagnoses a *real correctness hazard*
(divergent placement-ID formats), not just cosmetic tidiness. It respects the
persistence boundary (Rust/Yrs as source of truth), states it as an explicit
invariant to preserve, and frames the whole effort as internal re-layering with
no public-API change. The decomposition mirrors the established `tables/` and
`slicers/` sibling modules, which is the right architectural fit.

It loses points for one inverted/misattributed citation, for leaving the single
highest-risk decision (placement-ID unification observability) explicitly
*unresolved*, and for a behavioral-parity gate ("byte-identical bridge calls")
that names no mechanism to actually prove it.

## Evidence check (what I verified)

Confirmed accurate against the public source:

- `domain/pivots/` contents: only `style-normalization.ts` (46 lines) + one test.
- `PIVOT_CONFIG_SCHEMA_VERSION = 2` at `pivots.ts:69`; `makePlacementId` at `:83`
  producing `` `${area}:${fieldId}:${position}` `` (no prefix, no collision loop).
- `createStablePlacementId` at `pivot-bridge.ts:147` producing
  `` `${pivotId}:${area}:${fieldId}:${position}` `` with a `:${suffix}` collision
  loop — the divergence is real and exactly as described.
- `configWithRequiredMetadata` (`:91`), `dataConfigToApiConfig` (`:124`),
  `parseDataSource` (`:192`), `detectPivotFieldsForRange` (`:253`),
  `convertSimpleToDataConfig` (`:362`) with four `makePlacementId` call-sites,
  and `setDataSource` (`:1437`) — all present at the cited lines.
- `pivot-styles.ts`: local `BUILT_IN_PIVOT_STYLES` loop (`:14`, `i <= 28`) and the
  `'PivotStyleLight16'` default literal (`:26`), independent of the catalog —
  confirmed; `getDefault()` has no catalog validation, as claimed.
- The three named regression tests exist: `worksheet-pivots.test.ts`,
  `pivot-bridge.test.ts`, `pivot-event-bridge.source-identity.test.ts`.

**One citation is wrong and slightly inverted.** The plan repeatedly cites
`pivot-event-bridge.ts:1497` as keying off `refreshPolicy === 'refreshAndMaterialize'`
(objectives §4, contracts, Step 6). But `pivot-event-bridge.ts` is only 328 lines;
line 1497 is in `pivot-bridge.ts`. The event bridge's actual refresh decision is
at `pivot-event-bridge.ts:158`, and it keys off `refreshPolicy === 'dirtyOnly'`,
not `'refreshAndMaterialize'`. The underlying point (the event bridge hard-compares
the policy string and should consume the shared predicate) still stands, and the
plan's `sourceRangeChanged → dirtyOnly` semantics elsewhere are correct — but the
specific line/value pair an implementer would grep for is wrong, which is the kind
of error that wastes time at execution.

## Major strengths

- **Correctly identifies a latent bug, not just smells.** The two placement-ID
  formats genuinely diverge by creation path, and placement IDs are load-bearing
  identities (sort-by-value, Show-Values-As base, per-measure targeting). Framing
  unification as a correctness fix with a cross-path identity-stability test is the
  highest-value part of the plan.
- **Charter-aligned decomposition.** The proposed file shape
  (`style-catalog`, `placement-identity`, `config`, `field-detection`,
  `source-change`, `update-policy`, `index`) follows the documented `domain/`
  contract ("pure functions taking `DocumentContext`, no state, no business logic")
  and the `tables/`/`slicers/` precedent, including pure-vs-`ctx`-taking distinctions.
- **Atomicity invariant is precise.** The `setDataSource` extraction is specified
  to return `{ config } | { invalidReferences }` with *zero mutation* on the error
  path, preserving `PIVOT_UNRESOLVED_FIELD_REFERENCES`. That is exactly the
  invariant that matters and it is called out as the central one.
- **Single-source-of-truth catalog** with a validated default is a clean, testable
  win, and the plan correctly notes the dark-family count divergence (28 vs 11)
  with `tables/`, which would break a naive shared normalizer.
- **Honest non-goals and scope fencing.** No Rust/wire/compute changes, no TS config
  store resurrection, no API surface change, "delete don't wrap." Good.
- **Verification gates are mostly concrete** and per-module, with named regression
  suites and an explicit "don't touch the pre-existing dirty specs" note.

## Major gaps or risks

- **The top risk is acknowledged but not resolved.** The plan says placement-ID
  unification "must be settled before Step 2 lands" — whether the old unprefixed
  API form is ever persisted or is always transient pre-create. But the plan does
  not actually settle it; it offers two branches and defers. This is the crux of
  the whole effort (it determines whether Step 2 is a safe internal change or an
  observable identity migration), and the read-only investigation to answer it
  (does any code path persist a `makePlacementId` result before a pivot ID exists?)
  is exactly the kind of thing a planning pass should have closed. Leaving it open
  weakens an otherwise high-confidence plan.
- **"Byte-identical bridge calls" has no mechanism.** Gate §6 demands behavioral
  parity "except for the intended placement-ID unification" but names no harness
  (a call-recording/snapshot test? a spy on `updatePivot`?). Without one, this gate
  is unfalsifiable and likely to be skipped. It also self-contradicts: if placement
  IDs change, calls are *not* byte-identical, and the plan doesn't define how to
  isolate the "intended" delta.
- **Shared-normalizer ownership is ambiguous.** "Either folder's plan can own the
  helper; the other consumes it" invites a coordination gap when 017 (pivots) and
  the tables folder are planned/executed independently — likely outcome is two
  copies or a merge conflict. A plan should pick the owner (or declare 017 owns it
  and tables consumes) rather than leave it to chance.
- **Large blast radius bundled as one plan.** Seven steps mutating two very large
  files plus three bridges. Sequencing is given and parallelizable steps are
  flagged, but there is no fallback/rollback story if, say, Step 5's reconciliation
  extraction subtly changes which formulas the word-boundary regex flags. The risk
  is noted (preserve exact escaping) but mitigation is "be careful," not a guard.
- **No line budget / landing order as separate PRs.** Given the size, the plan would
  benefit from explicitly stating each step is an independently-mergeable PR with
  its own green gate, rather than one mega-change.

## Contract and verification assessment

Contracts are unusually well articulated: persistence boundary, compute-vs-refresh
side-effect line, update-options "policy table is the only constructor," refresh-policy
semantics, placement identity, `setDataSource` atomicity, schema-version single
authority, style canonicalization, and public-API stability are each stated as a
preserve-or-strengthen invariant. This is the strongest section of the plan.

Verification is solid for the pure modules (per-module unit tests are specific and
map cleanly to the extractions) and names the right regression suites. Two weak
spots: (1) the behavioral-parity gate lacks a method, and (2) the event-bridge
policy assertion is built on the misattributed line/value, so an implementer
following it literally would assert against the wrong condition. The "existing
style-normalization test passes unchanged" gate is a good, cheap canary.

## Concrete changes that would raise the rating

1. **Resolve the placement-ID observability question in-plan** (to 9): run the
   read-only investigation now — does any path persist `makePlacementId` output
   before a pivot ID exists, and do any fixtures/Yrs documents encode the
   unprefixed form? State the finding and pick the single minter accordingly, so
   Step 2 is unambiguous and provably safe.
2. **Fix the event-bridge citation.** Replace `pivot-event-bridge.ts:1497 /
   'refreshAndMaterialize'` with the actual `pivot-event-bridge.ts:158 /
   'dirtyOnly'`, and make Step 6's predicate match that condition.
3. **Specify the parity mechanism.** Define how "byte-identical bridge calls" is
   measured (e.g., a spy/snapshot over `updatePivot` args across the named
   scenarios) and how the intended placement-ID delta is excluded, or drop the gate
   in favor of the concrete unit/regression tests.
4. **Assign shared-normalizer ownership.** State that 017 owns
   `parseBuiltInStyle`/`normalizeStyleInput` (parameterized by prefix + family
   counts) and tables consumes it, rather than leaving it to either plan.
5. **Declare per-step PR boundaries and rollback.** Make explicit that Steps 1 and 6
   land independently, Step 5 ships behind its own green reconciliation suite, and
   note what to revert if regex-flagging parity fails.
