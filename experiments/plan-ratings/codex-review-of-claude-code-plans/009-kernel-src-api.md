Rating: 8/10

Summary judgment

This is a strong plan for `mog/kernel/src/api`: it correctly treats the folder as a production API gateway, grounds most objectives in observed source evidence, and focuses on contract consistency rather than feature churn. The best parts are the stale README correction, shared result/write-gate utilities, explicit public-surface invariants, and recognition that the Tier 2/Tier 3 context boundary and SDK conformance tests are load-bearing.

The plan falls short of a 9 or 10 because its highest-risk step, unifying `OperationResult` into throw-based operations, is under-inventoried and underspecified. `OperationResult` is not limited to `table-operations.ts` and `validation-operations.ts`; it appears across scenario, filter, format, grouping, hyperlink, merge, sheet-management, table, validation, and shared operation helpers. A plan whose central contract migration says "and any others found at edit time" is directionally right but not contract-clear enough for this folder.

Major strengths

- The plan is production-path relevant. It targets the API layer used by Shell, apps, SDK-facing document creation, workbook/worksheet APIs, and bridge-backed operations, not mocks or test-only wrappers.
- Evidence quality is mostly high. The stale README findings, missing `internal/unwrap.ts`, three inline `unwrapResult` copies, many duplicated `_ensureWritable` helpers, 16 production `as any` casts, and the persistence TODOs all match the current tree.
- The public invariants are well chosen: top-level export stability tags, public API throws, address resolution semantics, disposal ordering, write-gate timing, Tier 2/Tier 3 separation, and synchronous render/cache paths are the right contracts to protect.
- Sequencing is broadly sensible. README/result/write-gate cleanup can land mechanically before the larger operation-layer migration, and the plan correctly identifies Step 4 and Step 5 as the ripple-prone pieces.
- Verification thinking is stronger than average. It names unit tests for new helpers, conformance suites for SDK/security boundaries, typecheck, import-boundary linting, `as any` regression checks, and disposal-order coverage.

Major gaps or risks

- Step 4 needs a complete `OperationResult` census before implementation. Current source shows many result-returning operation modules beyond the two named examples, plus `wrapOp`, `validateAddress`, and `validateRange` in `worksheet/operations/shared.ts`. Migrating all of that is a real contract change, not just cleanup.
- The chosen failure convention is not justified against bridge/wire semantics. Some `OperationResult` usage decodes bridge payloads or reports validation failures without throwing. The plan should classify result boundaries into "internal operation should throw", "bridge decode still returns result", and "partial/batch result remains explicit" before prescribing migration.
- Write-gate centralization is slightly underspecified. Several helpers currently call `assertWritable` directly without `toMogSdkError` wrapping, while others wrap. The plan says preserve same exception behavior, but it does not inventory which classes currently wrap versus pass through.
- The "WorkbookImpl/WorksheetImpl remain unexported" wording is imprecise. The top-level `kernel/src/api/index.ts` does not export `WorksheetImpl`, and package exports only expose `./api`, but `kernel/src/api/worksheet/index.ts` does export it for deep/internal/test use. The plan should say "not exported from the public top-level API barrel" rather than "never exported."
- Step 6 may be a distraction in this plan. A lazy sub-API registration helper could be worthwhile, but changing 40 accessors in god-files carries disposal and initialization risk while delivering less contract value than Steps 2-5. It should either be deferred to a follow-up or specified with an exact accessor inventory and parity tests.
- Step 8 can exceed the folder scope. Implementing sort-spec or binding persistence may require bridge/engine work, so the plan should separate "track unresolved contract gap" from "implement now if existing bridge methods prove sufficient."

Contract and verification assessment

The contract framing is good: the plan understands that this folder translates public API inputs into document mutations and bridge calls, and that changes must preserve top-level exports, thrown-error semantics, address overload behavior, write-gate timing, disposal, and SDK security boundaries. The proposed helper tests are appropriate, and `pnpm test`/`pnpm typecheck` in `kernel` are the right package-level gates for TypeScript changes.

The verification section should become more executable. It names suites by directory, but the implementing plan should specify concrete commands such as `cd mog/kernel && pnpm test -- ...` patterns or full `pnpm test` plus `pnpm typecheck`, and it should include the package build/public export validation if any public type surface or `@stability` barrel content changes. For Step 4, verification must include callers of every migrated operation module, not only table/validation examples.

Concrete changes that would raise the rating

- Add a pre-implementation inventory table for every `OperationResult` producer and consumer in `kernel/src/api`, with a per-entry decision: migrate to throw, keep result boundary, or delete as dead.
- Define the exact typed `OperationResult` contract and `unwrapResult` behavior, including whether `affectedCells` and other extra fields are preserved or intentionally discarded.
- Inventory current write-gate wrappers and exception conversions before centralizing, then state the exact helper signature and required error identity/parity.
- Reword export invariants to distinguish public package exports, `kernel/src/api/index.ts`, deep source imports, and test-only imports.
- Split Step 6 into a separate optional follow-up unless it gets an accessor-by-accessor migration checklist and disposal/lazy-init parity tests.
- Turn verification gates into concrete commands and include public export/type validation when contracts or package barrels are touched.
