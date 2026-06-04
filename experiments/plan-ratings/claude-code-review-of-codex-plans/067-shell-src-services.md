Rating: 8/10

# Review of 067 — Shell Services Improvement Plan

## Summary judgment

This is a strong, evidence-grounded plan. Its author clearly read the real code: the claims I spot-checked are accurate, not invented. `createDocumentManager.ts` really is ~1000 lines (1064), `validatePathInProject` really does blind-lowercase-and-`startsWith` (`project-service.ts:136-140`), `deleteFile` really uses `startsWith(path + '/')` for descendant detection (`project-service.ts:629`), the trap coordinator really reaches into a structural `(handle as { _trapRecovery? })` cast (`trap-recovery-coordinator.ts:65`), and `ProjectServiceProvider` really has a `documentManager ?? createDocumentManager()` legacy fallback with a TODO to remove it (`project-service-context.tsx:131`). The verification gates point at test files that actually exist. This grounding is the plan's biggest asset and is rarer than it should be.

The plan correctly identifies the two genuinely high-value, correctness/security-relevant problems in this folder — path-boundary safety and non-transactional project/file operations — and proposes concrete contracts for both. It preserves the hard invariants (trap-recovery first-trap-wins, collaboration close semantics, dispose/open races) rather than hand-waving them.

The main weakness is scope discipline. This reads as a multi-quarter roadmap for the entire services layer (11 implementation workstreams, a new error taxonomy across six services, public-contract changes, a capability persistence subsystem, integration + E2E harnesses) rather than a single sequenced piece of executable work. It states path authority is "highest priority" but does not define a minimal first slice or an explicit ordering/landing strategy, so an implementer has no clear "do this first, ship it, then continue" path. Breadth this large risks never converging and makes the verification story aspirational in places.

## Major strengths

- **Accurate problem diagnosis.** The path-safety section is the standout: segment-aware boundary checks, runtime-authoritative case handling instead of TS lowercasing, and the `/project` vs `/project2` / `/project` vs `/project-file.xlsx` test cases all map to real defects in the current code. These are real latent data-loss/escape bugs, not cosmetic refactors.
- **Invariant-first framing.** The "contracts and invariants to preserve or strengthen" section is excellent — it enumerates dedupe/conflict rules, dispose-vs-open races, `disposeAll` semantics, trap-recovery guarantees, and recency skip rules before proposing changes. This is the right way to plan a refactor of race-sensitive code.
- **Concrete, real verification gates.** The TypeScript test commands reference files that exist on disk. The negative/edge-case test list (mixed separators, UNC, case modes, save-during-rename, `disposeAll` racing close+recovery) is specific and directly tied to the claimed defects.
- **Respects package boundaries.** Repeatedly flags that `ShellService` changes must go through `@mog-sdk/types-document` and that `mog` must not depend on `mog-internal`. Correct and important.
- **Honest non-goals and risks.** Explicitly forbids E2E-by-store-mutation, second source of truth for documents, weakening collaboration close, and TS-only path normalization. The risk list is real and self-aware (e.g. transactional ops exposing UI assumptions about intermediate store mutations).

## Major gaps or risks

- **No MVP / sequencing within the plan.** Eleven workstreams are listed and a parallelization section assigns owners, but there is no "land order," no dependency-ordered first deliverable, and no acceptance criterion for "phase 1 done." For a folder this central, the plan should carve out the path-authority + transactional-open slice as a standalone shippable unit and defer the rest.
- **Several items are conditional/speculative.** Section 6 ("if handlers need…", "Potential public contract updates") and the cross-tab `BroadcastChannel` idea ("if the kernel storage layer already exposes one") defer the actual contract decision to implementation time. A plan should resolve at least the gating question (does any action handler currently reach past `ShellService`? which ones?) rather than leaving it open.
- **Path-authority becoming async is under-analyzed.** Making `canonicalize`/`isWithinProject`/`join` return `Promise` (Tauri-backed) is the right call for authority, but it converts currently-synchronous validation paths into async ones across `ProjectService`. The plan does not flag the call-site ripple (every `validatePathInProject` caller, dedupe checks in hot paths) or whether a sync fast-path is needed. This is a real migration cost hidden behind a clean interface.
- **Capability persistence (section 7) is a feature, not a refactor.** Introducing `ShellCapabilityStorage`, rehydration-before-prompts, and policy-mode enums is net-new product surface with security implications (the plan itself warns about accidentally persisting dev/session grants). It sits awkwardly in a "services improvement" plan and would benefit from being split out with its own threat model.
- **Error-taxonomy breadth (section 5) risks churn-for-churn.** Six new error families across all services is a large, cross-cutting change whose payoff ("callers shouldn't parse `Error.message`") is asserted but not tied to a concrete current consumer that is parsing messages. Without that evidence it may be lower-value than the path/transaction work it competes with.
- **E2E gate is broad but unscoped.** "Exercise open/save-as/rename/delete/import/tab/close/recovery through real UI paths" is correct in spirit but is itself a sizable test-authoring project; the plan does not estimate or stage it.

## Contract and verification assessment

Contract clarity is above average. The `ProjectPathAuthority` interface is fully specified (canonicalize/isWithinProject/join/basename/dirname/extension/validateChildName/isDescendant) and the document-manager module split assigns crisp responsibilities per file. The invariants section gives testable assertions. Where it slips is the public `ShellService` facade (section 6), which is described as a menu of possibilities rather than a committed delta to `types/document/src/shell/types.ts`.

Verification is the plan's stronger half. Gates are layered (smallest-relevant-per-slice → full shell `pnpm test`/`typecheck` → public-type gates when `types/document` changes → Rust/Tauri gates if a canonicalization command is added → UI/E2E). The cited unit-test paths are real. Gaps: no gate explicitly proves the path-traversal fix (e.g. a test asserting `/project2/file.xlsx` is rejected against root `/project`) is called out as the acceptance test for the headline change; it's buried in the generic edge-case list. The Rust gate is appropriately conditional but vague ("the relevant Rust command tests") since the command may not exist yet.

## Concrete changes that would raise the rating

1. **Add an explicit phase plan with a shippable first slice.** Phase 1 = path authority + `validatePathInProject`/`deleteFile`/`openFile`-dedupe migration + the `/project` vs `/project2` regression test, landable on its own. Everything else sequenced behind it with stated dependencies. This is the single biggest lift.
2. **Resolve the speculative items into decisions.** Enumerate which action handlers (if any) currently bypass `ShellService` or reach `window.__SHELL__`, and commit to the exact `types-document` delta — or drop section 6 to a follow-up if the answer is "none today."
3. **Address the sync→async path-authority migration cost explicitly:** list affected call sites, state whether hot-path dedupe needs a synchronous canonical-cache, and how it interacts with the existing synchronous `validatePathInProject`.
4. **Split capability persistence (7) and the cross-service error taxonomy (5) into separate plans** (or mark them clearly deferred), justifying the error taxonomy with a concrete current message-parsing consumer if one exists.
5. **Tie each headline defect to a named acceptance test**, especially a path-escape rejection test and a save-during-rename ordering test, so "done" is mechanically checkable rather than narrative.
6. **Scope the E2E workstream** with a minimal must-cover list versus nice-to-have, since as written it could dwarf the refactor itself.
