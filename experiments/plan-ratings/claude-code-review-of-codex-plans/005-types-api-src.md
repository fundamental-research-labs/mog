Rating: 8/10

# Review of 005-types-api-src.md


## Summary judgment

This is a strong, evidence-grounded plan for hardening the `@mog/types-api` source
package and its public projection through `@mog-sdk/contracts`. Its diagnosis is
unusually accurate: every factual claim I spot-checked against the repo holds up,
and the plan correctly identifies the real production-path risk (a published
contract surface re-exported through `contracts` and consumed by two divergent
metadata generators). The verification gate list maps to scripts that actually
exist. The plan loses points mainly for packing an enormous, partly open-ended
scope into a single plan, for under-specified acceptance thresholds on the
type-hardening work, and for a sequencing bottleneck the parallelization section
glosses over.

## Major strengths

- **Verified, accurate situational analysis.** I confirmed the headline claims:
  - `types/api/package.json` exposes exactly **131** export subpaths (`jq '.exports | keys | length'`).
  - `types/api/src` contains exactly **133** TypeScript files.
  - The package is `"private": true`, named `@mog/types-api` — matching "workspace-internal build input."
  - The three named barrel-only files (`src/api/workbook/index.ts`,
    `src/api/worksheet/index.ts`, `src/kernel/floating-object-manager.ts`) all exist.
  - `contracts/src/api/workbook.ts` is literally a re-export shim
    (`export type * from '@mog/types-api/api/workbook'`) carrying the exact comment
    "Re-export shim. Source lives in @mog/types-api" — confirming the source-of-truth model.
  - The generator-drift thesis is real: `tools/generate-api-reference.ts` uses
    **hand-maintained** `WORKSHEET_SUB_APIS`/`WORKBOOK_SUB_APIS` Record literals
    (lines 85, 112) and `ROOT_INTERFACES = ['Workbook','Worksheet']`, while
    `runtime/sdk/scripts/generate-api-spec.ts` uses **ts-morph AST discovery**.
    These two paths genuinely can diverge — exactly the gap step 5 targets.
  - All thirteen verification commands resolve to real package scripts
    (`generate:api-ref`, `check:contracts-runtime-inventory`,
    `check:contracts-declaration-identity`, `check:contract-runtime-imports`,
    `check:api-snapshots`, `check:external-fixtures`, the SDK `generate:api-spec`),
    and `fixtures/external/{positive,negative}` already exist.
  This level of grounding is the plan's biggest asset — there is almost no
  speculative or hallucinated structure.

- **Production-path framing.** The "contracts and invariants to preserve" section
  is the best part of the plan. It states the right invariants (consumers import
  via `@mog-sdk/contracts/api`; runtime JS must not import private `@mog/*`;
  branded identity types need a single declaration owner; every change propagates
  to contracts + api-ref + sdk-spec + snapshots + fixtures in the same slice). This
  keeps the work anchored to the real publication boundary rather than to the
  private package in isolation.

- **No-shim discipline.** Explicitly forbidding temporary compatibility aliases and
  requiring source-of-truth + consumer coherence is the correct posture for a
  contract package and avoids the usual "tighten the type, cast at the call site"
  trap. Step 7 reinforces this by treating new `any`/`unknown` casts in consumers
  as failed contracts.

- **Ordered, contract-aware verification.** Gates run typecheck → parity → contracts
  build → both generators → agreement check → runtime/identity/snapshot/fixture
  gates → repo-wide typecheck. Treating generated-artifact diffs "as a contract
  diff, not mechanical churn" is the right instruction.

## Major gaps or risks

- **Scope is very large for one plan.** Steps 3–4 alone ask for an audit of every
  loose type across all 133 files (capabilities, services, workflows, store,
  kernel, apps, plus all API DTOs) and a per-shape DTO-ownership decision. Combined
  with generator rework (5), gate authoring (2, 6), and consumer integration (7),
  this is several plans' worth of work. The plan would be stronger if it carved out
  a phase-1 vertical slice (parity checker + the enumerated "production API holes"
  list) as independently shippable, with the broad audit as follow-on.

- **Sequencing bottleneck the parallel split hides.** The parallelization section
  assigns Agents B and C to harden types in parallel, then has a single Integrator
  do step 7 (kernel/apps/spreadsheet/runtime/sdk). In practice type tightening and
  consumer repair are tightly coupled — every narrowed type can surface a consumer
  break — so the "harden first, integrate after" serialization is the real critical
  path, and B/C cannot truly run free of the Integrator. The plan should acknowledge
  this coupling and define how partial hardenings land without leaving the repo
  un-typecheckable between slices.

- **Acceptance criteria are qualitative.** "Remove accidental looseness" and
  "split into intentional vs accidental" lack measurable targets. There is no
  baseline count, no enumerated `file:line` worklist for the priority holes, and no
  decision rule that an agent can apply mechanically to classify a given `unknown`
  as intentional vs accidental beyond four named buckets. Two agents will classify
  the same site differently. A concrete starting inventory (even a generated count
  per directory) and a written decision rubric would de-risk this.

- **Unbounded "implementation gap" risk.** The plan correctly notes (risks section)
  that tightening declarations can reveal real gaps in `kernel`/`apps`, but it does
  not bound that blast radius. If a tightened contract exposes a deep behavioral
  hole in kernel, step 7 implies fixing production runtime logic — which is
  out-of-scope per the stated non-goals ("Implementing runtime workbook behavior").
  There is no escape valve (e.g., "if the gap requires runtime behavior change,
  file it and keep a documented, tested intentional widening"). This tension could
  stall the integrator indefinitely.

- **Downstream-compatibility communication is thin for a folder whose risk is
  "downstream compatibility."** Snapshot/fixture gates will *detect* contract
  changes, but the plan says nothing about semver/changelog signaling for
  intentional narrowing/widening of a published type, or how external consumers are
  told. For the highest-risk attribute of this folder, detection alone is not the
  whole story.

- **Inventory location is vague.** Step 1 says the classification should "live in
  the public repo near existing package-boundary tooling" — but does not name the
  file or the schema, and step 2's parity checker depends on it. The allowlist
  format for barrel-only/internal files is also unspecified.

## Contract and verification assessment

The contract model is correct and well-articulated: single source of truth in
`types/api/src`, thin re-export shims in `contracts/src/api`, two downstream
generators, and a published `.d.ts` surface guarded by snapshots/fixtures/identity
checks. I verified the shim mechanism and both generators directly, and the plan's
description matches reality precisely.

Verification gates are the plan's second-strongest element. They are ordered
sensibly and every existing command is real. Two *new* gates are proposed — the
export/source/shim parity checker (step 2) and the docs-vs-spec agreement checker
(step 6) — and these are the right gates to add given the verified hand-maintained
vs AST-discovery drift. The weakness is specification depth: both new checkers are
described by intent ("fail if an export points at a missing artifact"; "confirm the
two generators agree on root members, accessors, method names, async model,
deprecation, source locations") but not by exact assertion contract, output format,
or how the agreement checker normalizes the two generators' differing schemas. A
reviewer cannot tell whether "agreement" is structural-equality or a curated subset
of fields. Snapshot expansion (step 6) is directionally right but does not say
which subpaths get captured or at what granularity.

## Concrete changes that would raise the rating

1. **Split into phases.** Define a shippable phase 1 = inventory + parity checker
   + the enumerated priority "production API holes," typecheckable end-to-end on its
   own. Make the broad 133-file audit and generator rework explicit follow-on
   phases. This alone would move the plan toward a 9.

2. **Attach a concrete worklist.** Replace "audit every loose type" with a generated
   baseline (count per directory and a `file:line` list for the priority holes), and
   add a written classification rubric so any agent buckets a given `any`/`unknown`
   the same way.

3. **Bound the implementation-gap blast radius.** Add an explicit escape valve:
   when tightening a contract would require runtime behavior change in kernel/apps,
   stop, document an intentional/tested widening, and file the gap — preserving the
   stated non-goal of not implementing runtime behavior here.

4. **Specify the two new checkers concretely.** Name the inventory file and schema,
   the allowlist format, the parity checker's exact failure conditions, and define
   the agreement checker's normalization and field-by-field comparison contract
   (including how differing generator schemas are reconciled).

5. **Resolve the sequencing coupling.** State how partial type hardenings land
   without leaving the workspace un-typecheckable, and acknowledge that the
   Integrator is on the critical path with Agents B/C rather than downstream of them.

6. **Add a compatibility-signaling step.** For a folder whose headline risk is
   downstream compatibility, specify how intentional contract narrowing/widening is
   versioned and communicated, not just detected by snapshots.
