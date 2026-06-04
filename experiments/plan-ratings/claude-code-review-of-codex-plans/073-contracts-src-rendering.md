Rating: 8/10

# Review of 073 — contracts/src/rendering


## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every specific factual claim it makes about the folder checks out against the actual source: the root barrel really is a blanket `export type * from '@mog/types-rendering'` (`index.ts:1`); the shipped subpaths really are exactly `./rendering`, `./rendering/sheet-view-skin`, `./rendering/coordinates`, `./rendering/constants` (verified in `contracts/package.json` exports); `coordinates.ts` really is a re-export shim into `@mog/types-rendering/coordinates`; the only test really does cover `DEFAULT_ROW_HEIGHT` and nothing else (`__tests__/constants.test.ts`); `RenderPriority` really is `CRITICAL=0 … IDLE=4` (`grid-renderer-primitives.ts:44`); and `DEFAULT_COL_WIDTH` really does a `navigator.platform` Mac sniff with a Node/test fallback (`constants.ts:34-41`). The referenced tooling (`tools/package-inventory.jsonc`, `tools/contracts-runtime-inventory.json`) and the verification scripts (`check:contracts-runtime-inventory`, `check:api-snapshots`, `check:external-fixtures`) all exist. A plan whose premises survive this much spot-checking is rare and earns most of its rating from that alone.

The diagnosis is also correct and well-framed: the folder's real weakness is not implementation capacity but that source-of-truth, public-leaf boundaries, runtime-vs-type ownership, and contract invariants are not *executable*. The objective of making the contract surface enforced by tests rather than convention is the right target for a contracts package.

The main reason this is an 8 and not higher: it is a program, not a plan. Thirteen implementation steps across eight parallel agents touching `contracts`, `types/rendering`, `types/viewport`, `grid-canvas`, `grid-renderer`, `sheet-view`, three spreadsheet systems, kernel, and print/export is a multi-week effort presented as one unit. Several steps are also under-specified at exactly the point where the work gets hard.

## Major strengths

- **Evidence-based and accurate.** The "current role" and "three kinds of files" taxonomy (runtime-bearing values, locally-composed contract types, re-export shims) matches the directory contents precisely. This is a reviewer's dream: I could verify rather than trust.
- **Correct invariant capture.** The production-path invariants section names real, load-bearing constraints — `RenderPriority` numeric ordering as contract, `updateContext()` staying O(patched fields) with no deep cloning on a hot path, "write = invalidate" scheduler semantics, acyclic `mog`→`mog-internal` direction, branded coordinates as zero-runtime. These are the things that would actually break if mishandled.
- **The `RenderContextConfig` undefined/omitted/null trichotomy** (step 7, invariant at line 55) is the single most valuable item in the plan. Ambiguity between "leave unchanged / use default / clear" is the classic god-object patch bug, and forcing per-key disposition is the right fix.
- **Verification gates are real and runnable** (modulo the no-run constraint of this review): the listed `pnpm` targets and root `check:*` scripts exist, so the gates are not aspirational.
- **Sequencing is sound.** "Inventory lands first; everything depends on knowing which symbols are public/private/runtime/type-only" is the correct dependency root, and the parity-before-subpath-expansion ordering correctly prevents leaking private-shard runtime through new public leaves.

## Major gaps or risks

- **Scope as a single deliverable.** Steps 12 ("update production consumers deliberately") and 13 ("regenerate API snapshots") implicitly gate on steps 1–11 across six-plus packages. There is no milestone or merge boundary. This should be split into at least: (a) inventory + parity tests (pure additions, low risk, mergeable alone), (b) explicit barrel + subpaths + snapshot churn, (c) the `RenderContextConfig`/data-source semantics changes that touch production callers. As written it's hard to land incrementally or to know when it's "done enough."
- **Under-specified where it matters most.** Step 7 says "type-level and test-level inventory for every `keyof RenderContextConfig`" but never enumerates the keys or proposes the actual disposition for any of them — the hard design work (what does `null` mean for, say, `clipboardSnapshot` vs `filterMetadata`?) is deferred to implementation. Same for step 9's "decide whether `sparkline-edit` and `hyperlink` are active contracts or removed" — the plan poses the question but doesn't commit to an answer or a decision criterion.
- **`export type *` → explicit-exports churn (step 2) is a breaking surface change** with under-acknowledged blast radius. Replacing a blanket re-export with an enumerated list will drop any symbol someone currently leans on transitively. The plan says "fix those call sites directly" but gives no way to know the current consumer set up front. An enumeration/audit of who imports what from the root barrel should precede this, not follow it.
- **"Do not add compatibility shims" + "treat surfaced bugs as production bugs" (steps 12, invariant 163) is correct in principle but raises landing risk.** A contracts change that exposes a latent stale-reader bug in `grid-canvas` now blocks the contracts PR on a renderer fix. The plan should explicitly allow decoupling: land the contract + test that *documents* the correct semantics, fix the consumer in a fast-follow, rather than forcing one giant atomic change.
- **Coordinate-factory runtime surface (step 5) trades one concern for another.** Adding `documentPoint`/`viewportRect`/etc. as contracts-owned *runtime* values grows the public runtime footprint — which the rest of the plan is trying to keep minimal and leak-free. The plan flags this in risks but doesn't justify why a public runtime factory is preferable to keeping construction type-only (branded casts) with documented patterns. That tradeoff deserves an explicit decision, not just a "keep them tiny" caveat.

## Contract and verification assessment

The contract framing is the best part. It correctly separates the three dispositions (contracts-owned runtime, locally-composed types, re-export shims) and ties each public symbol to a required source/owner/module/runtime-flag/consumer record driven by a test (step 1) — exactly the kind of executable boundary a contracts package needs. The parity-test direction (step 3: "either generate/project from a manifest, or prove object-shape parity") is the right framing because it refuses to settle for tolerance when shards disagree.

The verification gates are concrete and the named scripts exist. Two gaps: (1) the gates are listed as commands but not mapped to which step each gate guards — e.g. there's no statement that the inventory test (step 1) must pass before the barrel change (step 2) is even attempted, even though the prose sequencing implies it; (2) the plan leans on "exercise in the browser through the production path" for UI-facing changes but gives no concrete scenario list, so that gate is the weakest and least falsifiable one. Given this is mostly a type/contract change, most of the risk is genuinely caught by typecheck + the inventory/parity tests, so the soft browser gate is acceptable but should be scoped to the specific interactions changed (multi-region rect anchoring, hit-test of outline gutters).

## Concrete changes that would raise the rating

1. **Split into independently-mergeable phases** with explicit boundaries: Phase 1 = inventory + parity tests (additive, zero consumer impact); Phase 2 = explicit barrel + new subpaths + snapshot updates; Phase 3 = `RenderContextConfig`/data-source semantics + consumer updates. State which phases can land alone.
2. **Enumerate the `RenderContextConfig` keys** (or a representative cross-section) and commit to a proposed disposition for each, so step 7 carries the design instead of deferring all of it.
3. **Audit current root-barrel consumers before step 2** and include the list, so the blast radius of dropping `export type *` is known up front rather than discovered by breakage.
4. **Decide `sparkline-edit`/`hyperlink` now** (active contract vs remove-until-implemented) with a stated criterion, rather than leaving it open in step 9.
5. **Permit contract/consumer decoupling**: explicitly allow landing a contract + documenting-test ahead of the consumer fix when a latent bug is surfaced, instead of mandating one atomic cross-package change.
6. **Justify the runtime coordinate factories** against a type-only alternative, since they cut against the plan's own keep-runtime-minimal objective.
7. **Map each verification gate to the step it guards** and give a short, concrete browser-scenario list for the UI-facing gate.
