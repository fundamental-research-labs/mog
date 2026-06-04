Rating: 9/10

# Review of Plan 083 — Consolidate the protection runtime in `kernel/src/services/protection`

## Summary judgment

This is a strong, evidence-grounded refactor plan. Every load-bearing factual claim it makes is verifiable in the tree, and the few I spot-checked were correct to the line:

- The folder is a single 82-line `index.ts` with four `MutationResult` factories plus `hashExcelPassword`/`verifyExcelPassword`, and **no enforcement logic** — confirmed.
- `kernel/src/services/protection/index.ts` and `spreadsheet-utils/src/protection.ts` are identical except for the doc-comment header (`diff` shows only the header block differs) — confirmed.
- The kernel copy is dead: `rg "services/protection"` returns no hits outside the folder itself; every real consumer (`kernel/src/api/worksheet/protection.ts:18`, `kernel/src/domain/workbook/workbook.ts`, the two `apps/spreadsheet` editing files) imports from `@mog/spreadsheet-utils/protection`; the only thing pulling `from './protection'` is the kernel services barrel, and the one app file that imports `from '../services'` (`document-context.tsx`) pulls `installChartImageExporter`, not any protection symbol — confirmed dead.
- The standing TODO at `kernel/src/services/index.ts:263–265` exists verbatim — confirmed.
- `MutationResult` lives at `types/core/src/document/protection.ts:134` with exactly the `success`/`error`/`reason`/`affected` shape the factories produce — confirmed.
- The hand-rolled comparison: `checkPassword` at `:230–231`, `pauseProtection` at `:176–180`, and `protectionPasswordHash ?? null` normalization throughout — confirmed.

The plan correctly diagnoses the situation (duplication + dead code + a self-flagged TODO whose deferral condition is now satisfied), picks the dependency-edge-free target (`@mog/spreadsheet-utils` is already a kernel dependency, so consolidating *into* it adds no new edge), and front-loads the one genuinely dangerous risk — silently changing a persisted hash — with a golden test gated *before* deletion. That sequencing instinct is exactly right for a security/format-compat-relevant move.

## Major strengths

- **Pure-move discipline on the hash.** It explicitly forbids "tidying" the bit arithmetic, names the persistence surface (`.xlsx` files + `protectionPasswordHash` settings), and makes gate #1 a precondition rather than a follow-up. This is the single most important thing to get right and the plan treats it that way.
- **Correct architectural target with a dependency-cycle argument.** It doesn't just assert the home; it reasons about import cycles and shows the chosen home introduces zero new edges. The concern-split (`protection-password.ts` vs `mutation-result.ts`) honors the TODO's intent while a thin `protection.ts` barrel keeps every consumer import statement and the `package.json` `"./protection"` subpath stable — verified that subpath export and the root `src/index.ts` re-export both exist.
- **Verification gates are concrete and falsifiable.** Single-definition `rg` gate, dead-export `rg` gate, golden hash values, a `verifyExcelPassword` branch table, and an `.xlsx` round-trip integration check. These are the right gates and they're specific enough to execute.
- **Honest about non-goals.** Symbol renaming (cross-package import contract), real cryptography, enforcement behavior, and the `allowEditRanges` in-memory gap are all explicitly fenced off and correctly attributed to other owners.
- **Comment-convention compliance.** It applies the repo's no-"Excel"-in-source-comments rule and ties it to the right scope (comments only, not symbol names).

## Major gaps or risks

- **Step 3's consolidation benefit is overstated.** The plan frames routing through `verifyExcelPassword` as removing "the second hand-rolled comparison." But the call sites and the helper have genuinely different contracts for the no-stored-hash case: `checkPassword` returns `!password` when `!storedHash` (line 225–226), whereas `verifyExcelPassword` returns `true` unconditionally for an empty stored hash. So `verifyExcelPassword` can only legitimately replace the *inner* `inputHash === storedHash` line that runs **after** each site's own `if (!storedHash)` guard — the guards must stay. The net reduction is one expression per site, not the elimination of a parallel implementation. The plan does flag this edge case (and tells the implementer to confirm per-branch semantics + add regression tests), which is why this is a deduction and not a fault — but the prose in the "improvement objectives" and Step 3 oversells the dedup relative to what the code actually permits. Worth a sentence making explicit that the swap is line-level, not function-level.
- **The existing test file is weaker than the gate assumes.** `spreadsheet-utils/__tests__/protection.test.ts` already imports both functions, but its `hashExcelPassword` assertions check length/determinism/difference — not a pinned known-good hex string. So gate #1's golden values are genuinely *new* work, not "strengthen the existing case." The plan says the test file "already imports these symbols," which is true and useful, but a reader could infer the golden lock already half-exists. Minor, but it slightly understates the work.
- **`null` vs `''` normalization is real and only partially closed.** Call sites normalize to `null` (`?? null`); the helper keys on falsy (`!storedHash`), which catches both `null` and `''`. The plan flags this in Risks and asks for a regression test — adequate — but it could state the conclusion (both are falsy, so the helper is safe) rather than leaving it as an open "confirm."

## Contract and verification assessment

Contracts are stated precisely and match the code: the four factory shapes line up with `MutationResult` at `types/core/src/document/protection.ts:134`; the hash output contract (4-char uppercase hex, padded) and the `verifyExcelPassword` empty-hash/empty-input branches are quoted accurately. The "exactly one definition" invariant is the right post-condition and is mechanically checkable.

Verification gates are above average for this experiment: they pair behavioral gates (branch table, kernel API parity, `.xlsx` round-trip) with mechanical gates (`rg` single-definition, `rg` dead-export, comment scan). The one soft spot is that the kernel-API-parity gate (#3) needs to assert the *unprotected-sheet* branch specifically, since that is exactly where `checkPassword`'s `!password` semantics diverge from a naive `verifyExcelPassword` substitution — the plan should pin that case as a named assertion rather than folding it into "no-password sheets."

## Concrete changes that would raise the rating

1. In Step 3, state explicitly that `verifyExcelPassword` replaces only the post-guard `inputHash === storedHash` expression at each site, and that each site's `if (!storedHash)` branch (notably `checkPassword`'s `return !password`) must remain unchanged. This removes the "function-level dedup" implication.
2. Add a named parity assertion: `checkPassword(password)` on a sheet with **no** stored hash must still return `!password` after the refactor (the divergence point), distinct from the generic "no-password sheet" case.
3. Clarify that gate #1's golden hex values are new assertions (the current test only checks length/determinism), so the implementer doesn't assume the lock already exists.
4. Resolve the `null`/`''` edge in the plan itself: both normalize to falsy under `!storedHash`, so the helper is safe — keep the regression test, but state the conclusion rather than leaving it open.

These are refinements, not corrections. The plan is accurate, well-sequenced, correctly scoped to a single landable PR, and right about the one thing that could cause real damage. It is ready to implement essentially as written.
