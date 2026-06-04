Rating: 8/10

# Review of 071 - Contracts Core Improvement Plan


## Summary judgment

This is a strong, unusually well-grounded plan. I independently verified its central
factual claims against the live source and every one held:

- `contracts/src/core/execution.ts` is byte-identical to `types/commands/src/execution.ts`
  (confirmed via `diff`), including the runtime constants `DEFAULT_EXECUTION_TIMEOUT = 30000`
  and `API_CALL_TIMEOUT = 10000`.
- `contracts/src/core/schema.ts` is byte-identical to `types/commands/src/schema.ts`,
  and `ValidationErrorCodes` is a runtime `const` at `types/commands/src/schema.ts:360`
  with `ValidationErrorCode` derived from it via `typeof` at line 386 — exactly the
  derivation relationship the plan flags as a hazard.
- `contracts/src/core/formatted-text.ts` is byte-identical to `types/core/src/formatted-text.ts`.
- `core.ts` owns `MAX_ROWS = 1_048_576`, `MAX_COLS = 16_384`, `sheetId`, `rangeId`, and the
  `RangeKind` enum, with `export type *` projection — matching the plan's description.
- The cited downstream duplicate exists verbatim: `apps/spreadsheet/src/domain/fill/types.ts:373`
  `export const MAX_ROWS = 1_000_000;` (note: a *different* value than the Excel bound).
- Rust `cell_types::RangeKind` (`compute/core/crates/types/cell-types/src/range_id.rs:106`)
  enumerates the same variants the plan lists.
- The reference pattern in `contracts/src/cells/cell-identity.ts` (ownership comment + branded
  factory) exists and is exactly what the plan proposes propagating to `execution.ts`.
- All referenced tooling and npm scripts exist: `check-contracts-declaration-identity.mjs`,
  `check-contracts-runtime-inventory.mjs`, `contracts-runtime-inventory.json`,
  `package-inventory.jsonc`, and the `check:*` scripts in the root `package.json`.
- The type-shard subpath exports the refactor depends on (`@mog/types-commands/execution`,
  `/schema`, `/commands`) are declared in `types/commands/package.json`, and the public
  subpaths (`./core`, `./execution`, `./schema`, etc.) exist in `contracts/package.json`.

The diagnosis (split-brain duplicated type bodies that should be type-only projections, with
contracts retaining ownership only of runtime values) is correct and the prescribed direction
matches an already-established in-repo idiom. The plan is honest about what it did not run and
about which steps are decisions rather than mechanical edits.

The main reasons it is not a 9–10: scope sprawl relative to the trivial size of most of these
files, one genuinely open-ended research step dressed as an implementation step (CellValue/wire
audit), and a couple of verification gates that are broad enough to be expensive proxies rather
than targeted checks.

## Major strengths

- **Evidence-backed, not speculative.** The inspected-files list is real, the duplication
  claims are exact, and the one named downstream offender is precisely located. This is the
  rare plan where the "current state" section can be trusted without re-deriving it.
- **Correct source-of-truth model.** "Types authored in tier-0 shards; public runtime values
  owned and emitted by contracts" is the right invariant and is already partially realized
  (`cell-identity.ts`, `core.ts`). The plan generalizes an existing good pattern rather than
  inventing one.
- **Sharp on the subtle hazards.** It explicitly calls out (a) `export type *` + local runtime
  export name-collision risk, (b) that `ValidationErrorCode` must keep deriving from a value and
  must not accidentally derive from a *private* runtime value, (c) that declaration source-location
  moves are only safe if API-snapshot and declaration-identity gates still pass, and (d) that
  `RangeKind` value parity (not ordering) is the real cross-language contract. These are exactly
  the traps that bite this kind of refactor.
- **Production-path framing.** It distinguishes the Excel sheet bound from intentionally smaller
  algorithmic limits and warns against blindly replacing `1_000_000` — which matters, because
  `fill/types.ts` may legitimately want a smaller fill cap, not the 1,048,576 ceiling.
- **Governance-as-code.** Turning the facade into an inventory wired into existing boundary
  tooling (rather than prose docs) is the correct way to keep a foundational contracts folder
  from re-rotting.

## Major gaps or risks

- **Scope/effort mismatch.** Five of these files are 1–4 line shims. The plan proposes a new
  checker, an inventory, package-level test suites, expanded external fixtures, wire-shape audits
  across Rust/bridge/file-io, and a 7-agent parallel split. The duplication fix itself (steps 2–4)
  is small and high-value; much of the rest is governance gold-plating that a reviewer should
  green-light only if the team actually wants a hardened foundation tier. The plan would be
  stronger if it ranked the steps by value so an implementer could stop after the high-leverage
  ones.
- **Step 10 (CellValue / wire-shape audit) is research, not a plan.** "Decide whether arrays,
  controls, or images belong in the public union" is an open design question with real product
  consequences and no proposed answer or decision criterion. It is correctly fenced as needing a
  deliberate decision, but bundling an unbounded investigation into an otherwise mechanical
  refactor risks blocking the safe 80% on the uncertain 20%. This should be split into its own
  tracked item.
- **The new `check-contracts-core-facade` gate is underspecified.** It is described by its
  responsibilities (six bullet points) but not by where it reads canonical values from, how it
  parses Rust (it defers to "generated bridge output as the primary parity surface," which is
  reasonable but not pinned down), or how it reconciles with the *existing*
  `check-contracts-runtime-inventory.mjs` to avoid two overlapping inventories. There is a real
  risk of building a second governance file whose relationship to the current one is ambiguous.
- **Broad verification proxies.** Repo-wide `pnpm typecheck` and `@mog-sdk/kernel test` /
  `@mog/app-spreadsheet test` as gates are appropriate for the *integration* step but are heavy;
  the plan doesn't say which focused tests would catch a regression first, so a failing run could
  be slow to localize. (It does list focused kernel/app tests, which mitigates this partially.)
- **Parity-check duplication paradox unaddressed.** The plan keeps `ValidationErrorCodes` and the
  timeout constants as *intentional* runtime duplicates guarded by parity checks. That is sound,
  but the parity check must compare the contracts-owned value against the shard at build/test time
  — and the shard is a forbidden *runtime* dependency for the shipped artifact. The plan should
  state explicitly that the parity comparison runs in a dev/test context (where importing the shard
  is allowed) and is not part of shipped JS, to avoid an implementer accidentally reintroducing a
  private runtime import to satisfy the check.

## Contract and verification assessment

Contract clarity is high. The invariants section pins concrete, checkable values:
`MAX_ROWS = 1_048_576`, `MAX_COLS = 16_384`, `RangeKind` member set, `ExecutionStatus` and
`ChangeType` literal unions, the two timeout constants, and `RangeKind`/`RangeAnchor` serde shape
requirements. These are all verifiable and I confirmed the current code matches them, so the gates
have real anchors to assert against.

Verification gates are comprehensive and correctly layered: package typecheck/test/build, the
existing boundary checks (`check:contract-runtime-imports`, `check:contracts-declaration-identity`,
`check:declaration-rollups`, `check:api-snapshots`, `check:external-fixtures`), Rust `cargo test -p
cell-types` gated on touching `RangeKind`, and downstream kernel/app consumer suites. The drift
tests ("prove execution.ts and schema.ts no longer carry copied type bodies") are a nice
forward-looking guard. The notable weakness is that the single most important new gate is the one
least specified.

The plan is honest that the planning worker did not run any gates, and the gate list maps onto
scripts that genuinely exist, so this is executable rather than aspirational.

## Concrete changes that would raise the rating

1. **Prioritize.** Mark steps 2–6 (the duplication removal + ownership comments + facade intent)
   as the high-value core, and 1/7/8/9 (inventory, tests, fixtures, new checker) as a second tier,
   and 10 (CellValue/wire audit) as a separate spun-out investigation. This lets a reviewer approve
   the safe refactor without committing to the whole program.
2. **Specify the new checker concretely.** State its canonical sources per value, how it relates to
   the existing `check-contracts-runtime-inventory.mjs` (extend vs. add), and the AST library/approach
   — or fold its responsibilities into the existing inventory checker if they overlap.
3. **Make the parity-check execution context explicit.** Document that parity comparisons import the
   private shard only in dev/test, and add an assertion that the *built* artifact contains no
   `@mog/*` / `@mog-sdk/types-*` / `@rust-bridge/*` runtime import (the plan lists this as an
   invariant but should tie it to a specific gate run on the built JS).
4. **Resolve the `fill/types.ts` ambiguity in the plan, not at implementation time.** Decide now
   whether `1_000_000` is a fill-specific cap (rename + document) or a mistaken sheet bound
   (replace with imported `MAX_ROWS`). The current value differs from the Excel bound, which is a
   tell that it may be intentional — the plan should pick a default and let the implementer confirm.
5. **Bound step 10.** Give the CellValue audit a decision criterion ("variant X is in-scope iff it
   can cross the bridge to a public consumer today") and a default (fence unsupported variants at
   the bridge) so it cannot silently expand the public union or stall the refactor.
6. **Trim the integration gates to a localizing order.** List the single fastest test that would
   fail first for each refactor (e.g., the declaration-identity check for branding regressions,
   `sheetid-boundary.test.ts` for identity) before the repo-wide typecheck, so failures localize
   quickly.

## Verification note

The only file I created or modified is this review at
`mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/071-contracts-src-core.md`.
All other commands were read-only inspection (`diff`, `rg`, `ls`, `cat`). I did not edit the plan,
production code, fixtures, configs, or run any build/test/typecheck/verification commands.
