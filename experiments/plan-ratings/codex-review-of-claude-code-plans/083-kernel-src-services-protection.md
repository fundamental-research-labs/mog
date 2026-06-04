Rating: 8/10

Summary judgment

This is a strong, production-path-aware consolidation plan. It correctly recognizes that `kernel/src/services/protection` is not an enforcement service today, that enforcement lives through `computeBridge`, and that the kernel service file is a duplicate of the actually consumed `@mog/spreadsheet-utils/protection` module. The plan is well grounded in the import graph, preserves the public import path that real consumers use, and names the highest-risk persisted-hash invariant explicitly.

The rating is not higher because the proposed final home is still partly a compromise: `spreadsheet-utils` is a practical single source of truth, but it is not actually "next to MutationResult" and not the xlsx/bridge home called out by the existing TODO. The plan also leans on an under-evidenced "no Excel in comments" convention and does not provide concrete golden hash vectors, which weakens the verifiability of its most important safety gate.

Major strengths

- The diagnosis is accurate: the source folder contains helper factories and password hashing only, while `WorksheetProtectionImpl` delegates protection decisions to the compute bridge.
- The import-graph reasoning is strong. Current production callers import from `@mog/spreadsheet-utils/protection`, and the kernel copy appears reachable only through `kernel/src/services/index.ts`.
- The compatibility strategy is good: keeping `spreadsheet-utils/src/protection.ts` as a thin re-export preserves the existing package subpath export and avoids broad churn in consumers.
- The plan calls out the right behavioral contracts: byte-stable legacy hash output, `MutationResult` result shapes, no new package dependency edge, and unchanged WorksheetProtection behavior.
- The sequencing is sensible: add/strengthen tests before deleting the duplicate, then remove the dead kernel barrel export, then route inline password comparisons through the shared helper.
- The plan distinguishes this refactor from protection enforcement work, real cryptography, allow-edit-range persistence, and API surface changes.

Major gaps or risks

- The stated semantic-home objective is only partially satisfied. Moving both concerns into split files under `spreadsheet-utils` removes duplication, but `mutation-result.ts` still does not live beside `types/core/src/document/protection.ts`, and password hashing still does not move to an xlsx/file-IO bridge. The plan should either defend `spreadsheet-utils` as the intended long-term home or label it as an explicit intermediate consolidation.
- The `verifyExcelPassword` no-stored-hash behavior is not a direct drop-in for every call site. `checkPassword` currently returns `false` for a non-empty supplied password when no password is stored, while `verifyExcelPassword('anything', '')` returns `true`. The plan notices this, but the implementation step should prescribe the exact branch structure instead of relying on "map it without behavior change."
- The "no Excel in comments" requirement is weakly supported by the inspected tree. There are many intentional Excel compatibility comments elsewhere, and the cited `[[no-excel-in-code]]` convention was not discoverable in the public repo. That objective may be valid internal policy, but the plan should cite an actual local source or narrow the requirement to this file's comments only.
- The hash golden-test gate is correct in spirit but underspecified. It should include the exact expected output table and say those values come from an independent format reference or fixture, not from recomputing with the current implementation.
- The verification section names packages and behaviors but does not give exact commands or test-file targets. For a cross-package TS refactor, explicit `pnpm --filter ... test` and `pnpm --filter ... typecheck` gates would make the contract easier to execute and audit.

Contract and verification assessment

The contract section is the plan's best part. It identifies the persisted-hash compatibility hazard, keeps import surfaces stable, and gives concrete `MutationResult` object shapes. It also correctly includes single-definition and dead-export search gates, which are appropriate for a de-duplication task.

The verification plan is good but should be made more executable. It should require focused spreadsheet-utils tests with fixed hash vectors, kernel API tests for `checkPassword`, `pauseProtection`, and `setPassword`, and package type gates for `@mog/spreadsheet-utils`, `@mog/kernel`, and `@mog/app-spreadsheet`. The xlsx round-trip gate is relevant, but it should identify an existing fixture/test path or require adding one if none exists. The current plan's "typecheck/build" wording is too broad to prove that the actual import/export contract remains intact.

Concrete changes that would raise the rating

- State whether `spreadsheet-utils` is the permanent architecture or an intentionally narrow first-step consolidation; if permanent, explain why it is preferable to `file-io/xlsx*` for the password helpers and to a runtime contracts-adjacent module for result factories.
- Add a table of golden hash vectors, including `''`, at least one simple ASCII password, a length-sensitive case, and a known protected `.xlsx` fixture value.
- Specify exact replacement logic for `checkPassword` and `pauseProtection` so `verifyExcelPassword` cannot accidentally broaden the no-password case.
- Replace the unsupported comment-convention citation with a concrete repo document, or downgrade it to a local cleanup recommendation.
- Name the exact test files and commands expected after implementation, plus the exact `rg` patterns that must return one definition and no dead kernel protection-service import.
