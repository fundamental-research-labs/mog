Rating: 6/10

Summary judgment

This is a strong investigation plan with a clear read of the intended `contracts/src/security` role: a public facade over canonical document-security types plus one runtime value. It correctly identifies dead duplicate files, an optional brand that is not actually nominal, and the need for enforced Rust/TS wire-shape alignment. However, its central runtime re-export step is not currently safe for the public package boundary, and the plan does not fully reconcile the current Rust `AccessExplanation` shape with the TypeScript contract it proposes to preserve. Those two issues are production-path blockers, not minor cleanup details.

Major strengths

- The plan is evidence-driven. It names the files in scope, the canonical `types-document` source, the Rust `AccessLevel` authority, current consumers, runtime inventory, and API snapshot guardrails.
- It preserves the right high-level architecture: TypeScript remains contracts/facade only, while enforcement and policy evaluation stay in Rust.
- The orphan-file cleanup is well specified and low risk: confirm no package exports or imports of `@mog-sdk/contracts/security/types` and `.../evaluator`, then delete the unreachable copies.
- The plan treats `ACCESS_LEVEL_ORDER` as a real runtime contract instead of a convenience helper. That is the right level of seriousness because wrong ordering silently corrupts permission comparisons.
- Verification expectations are broader than compile-only checks: runtime fixture, public API snapshot, negative type test for `PolicyId`, import proof, and a Rust/TS lattice invariant.

Major gaps or risks

- The proposed `export { ACCESS_LEVEL_ORDER } from '@mog-sdk/types-document/security'` likely breaks the public package boundary. `@mog-sdk/contracts` is public and currently lists `@mog-sdk/types-document` under `devDependencies`, while `@mog-sdk/types-document` is private. Type-only re-export shims are projected into declarations during build, but a value re-export would emit a runtime import from a private package unless the build is changed to inline/bundle it or the dependency/publishing model changes. The plan incorrectly says no dependency change is required.
- The `AccessExplanation` contract is already more divergent than the plan states. The TypeScript interface has `matchedPolicy`, `candidatePolicies`, and `warnings`, while Rust `compute_security::engine::AccessExplanation` includes fields such as `effective_tags`, `candidate_policies`, `sorted_policies`, `matched_policy`, `ambiguity`, `clamp_fired`, and `reason`. The plan asks to bind the old TS shape to Rust rather than first deciding the actual public wire contract and migration compatibility.
- The plan under-specifies how Rust/TS parity will be enforced. It says to locate or add codegen/snapshot tooling, but a plan of this quality should name the existing hook or explicitly specify the new fixture format, generator location, and checked artifact.
- Tightening `PolicyId` is correct, but it is a public type behavior change. The plan mentions construction-site casts, but it does not assess API Extractor/API snapshot impact, SDK generated API spec impact, or downstream source compatibility for callers passing stored policy id strings back into `removePolicy`/`updatePolicy`.
- Step 3 derives `ACCESS_LEVEL_ORDER` with `Object.fromEntries`. That is acceptable if verified, but it changes a zero-dependency literal into module-load computation and may widen declaration output unless carefully typed. The plan should require checking the emitted `.d.ts` and runtime JS, not only structural fixture equality.
- The scope crosses `contracts`, `types/document`, Rust compute-security, tooling, snapshots, and SDK generated outputs. That may be the right architectural scope, but the sequencing needs clearer ownership boundaries so a `contracts/src/security` worker does not make public-package changes that depend on unlanded private-type or Rust-codegen changes.

Contract and verification assessment

The contract goals are directionally right: one authority for access-level ordering, no duplicate type copies, real nominal `PolicyId`, and CI-checked Rust/TS parity. The strongest part is the explicit preservation list for public exports and bridge wire shapes.

The verification plan is incomplete in two production-critical places. First, it must include a published-package/runtime-resolution check proving `@mog-sdk/contracts/security` can be imported from built `dist` without workspace-only private packages. The current proposed value re-export makes that check essential. Second, the `AccessExplanation` parity test must compare the actual bridge-returned JSON shape, including naming convention and optionality, rather than the current prose-only TS interface.

The plan also should name concrete commands or package gates for this repo: at minimum the relevant `contracts` type/build checks, API snapshot check/update flow, runtime inventory check, the security Rust crate tests/clippy for changed Rust fixtures, and SDK API-spec regeneration if public SDK types move. The listed gates are conceptually good but too abstract for an implementer to know when the production path is actually green.

Concrete changes that would raise the rating

- Replace the direct runtime re-export with a public-package-safe single-source mechanism: either generate `contracts/src/security/index.ts` from `types/document/src/security/types.ts`, bundle the value into `@mog-sdk/contracts` at build time, or explicitly change the package model so any runtime import is published and declared as a real dependency.
- Add an explicit package-boundary requirement: built `@mog-sdk/contracts/security` must have no runtime import of private `@mog-sdk/types-document`, and the runtime import check must be part of verification.
- Rework the `AccessExplanation` section around the actual Rust serde shape and the bridge naming behavior. Decide whether TS should expose the full Rust shape, a compatibility adapter, or an intentionally transformed public shape, then test exactly that.
- Specify the Rust/TS invariant mechanism concretely: fixture schema, generator/test file names, expected checked-in artifact, and the command that fails when Rust names/discriminants or struct fields drift.
- Treat `PolicyId` as a public API tightening: include migration notes, generated SDK/API snapshot expectations, and type-level tests for both rejected plain strings and accepted ids returned from `addPolicy`/`applyTemplate`.
- Add a short dependency/ownership table separating changes in `contracts/src/security`, `types/document/src/security`, `compute-security`, tooling, and generated SDK/API artifacts, with merge ordering for each.
