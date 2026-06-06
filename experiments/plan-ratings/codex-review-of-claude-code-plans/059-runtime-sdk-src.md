Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for a sensitive public SDK surface. It correctly treats `runtime/sdk/src` as a production API boundary rather than a convenience wrapper, and the evidence mostly checks out against the current tree: `createWorkbook().dispose` is fire-and-forget, the deprecated headless path bypasses the host-backed trust adapter with `as any`, API introspection eagerly imports the generated JSON, coordinator calls are ad hoc typed, and byte identity currently materializes full byte arrays.

The rating is not higher because several proposed fixes need sharper cross-package contracts before an implementation worker can execute them safely. In particular, the `dispose()` objective conflicts with existing public lifecycle contracts unless those contracts are explicitly changed, and the direct byte-hash proposal cannot be SDK-local because kernel import validation independently recomputes the same immutable byte-handle identity.

Major strengths

- Excellent folder inventory and role definition. The plan identifies the public package surface, generated integration, deprecated-but-load-bearing headless path, host adapter trust boundary, chart export path, and API introspection responsibilities.
- Evidence is specific and actionable. The cited defects are not vague cleanup items; they point to production seams with concrete failure modes: async teardown races, untyped kernel-host boundary calls, eager startup cost, NAPI return-shape uncertainty, and O(file) transient allocation.
- Architectural instincts are mostly right. The plan preserves fail-closed creation, keeps branded host-context construction confined, treats `createWorkbook` overload semantics as frozen, and recognizes that collaboration cannot be casually rewritten.
- The sequencing is reasonable for parallel work. Diagnostics deduplication, API spec loading, byte fingerprinting, barrel clarity, and coordinator typing can be worked by different agents if their contracts are pinned first.
- Verification coverage is better than average. It names existing SDK tests, proposes targeted regressions, calls out API-extractor review, and includes behavior checks for disposal, source-handle rejection, introspection parity, and collaboration lifecycle.

Major gaps or risks

- The `dispose()` fix is under-specified against the actual public contract. `contracts/src/sdk/lifecycle.ts` states that `workbook.dispose()` is synchronous local cleanup and that `close()` / async disposal are canonical close paths; generated API metadata also exposes `dispose(): void`. The plan acknowledges a possible contract change, but still frames "make `dispose()` awaitable" as Step 1. It needs to decide whether the correct fix is a cross-contract breaking change, a new async close/dispose path, or a synchronous dispose that no longer claims to await native teardown.
- Step 3 would break imports if implemented only in `runtime/sdk/src`. `kernel/src/document/host-import-source.ts` recomputes immutable byte-handle identity with `createHostCanonicalFingerprint({ bytes: Array.from(bytes), sizeBytes })` and compares it to the issued identity. Changing the Node host to `sha256(bytes + size)` requires an atomic shared identity-contract change in the kernel/types-host side, not just matching SDK issuance and resolver code.
- The lazy API spec design needs a packaging contract, not only a code sketch. Because `index.ts` statically re-exports `api` and `apiSpec`, and `tsup.config.ts` builds a single unsplit entry bundle, replacing the top-level JSON import with a lazy loader may avoid parse cost but still bundle or copy the 4.95 MB artifact unless the asset/export strategy is explicit. Runtime schema validation also needs a dependency-free validator or generated guard story.
- Creation-path consolidation is still a design fork. Step 6 says either route collaboration onto the host-backed boundary or keep a typed raw wrapper, but those are different architectures with different trust, sync-port, Yrs-state, and workbook-link consequences. The plan should pick the intended substrate and define the exact public and internal contracts it requires.
- The stated `src` scope conflicts with the required fixes. A correct implementation likely touches contracts, kernel/type-host identity helpers, native NAPI declarations, tests, API extractor output, possibly scripts/generator code, and docs. The plan flags some cross-folder dependencies, but the work breakdown should separate SDK-local changes from cross-package contract changes so implementation agents do not try to force contract work into `src`.
- Verification is strong but not yet fully operational. It names useful gates, but should spell out exact package commands and add explicit bundle/startup checks for the API spec change, shared identity tests for the byte hash change, and native/coordinator contract tests that fail when the NAPI return convention drifts.

Contract and verification assessment

The plan has a good contract mindset: it enumerates overload semantics, fail-closed host creation, import durability, trust profile semantics, branded-context confinement, API-introspection shape stability, timezone behavior, and API-extractor visibility. Those invariants are the right ones for this folder.

The weak point is that two proposed contract changes are not fully reconciled with the existing public contract surface. `dispose(): void` versus awaitable native teardown must be resolved at the `@mog-sdk/contracts` and generated API spec level. Immutable byte identity must be defined once, preferably in a shared helper or explicit host-source identity contract, then used by both host issuance and kernel verification.

For verification, the plan should keep the named SDK Jest tests and add the proposed regressions, but the final gate list should be command-level and package-aware: SDK test, SDK typecheck, API report, publish/build smoke, plus kernel/type-host tests if fingerprint semantics move. For Step 4, a test must prove both semantic parity and import-cost reduction; "lazy loader exists" is not enough.

Concrete changes that would raise the rating

- Make Step 1 a contract decision first: either preserve `dispose(): void` and route full teardown through `close()` / `[Symbol.asyncDispose]`, or explicitly update `Workbook`/SDK lifecycle contracts, generated API spec expectations, examples, and API report to make `dispose()` promise-returning.
- Rewrite Step 3 around a shared immutable-byte-identity helper used by both `runtime/sdk/src/host-adapters/node-headless-host.ts` and `kernel/src/document/host-import-source.ts`, with tests proving issued identity, resolver identity, and byte-verification identity match.
- Specify the API spec loading architecture in publish terms: whether the JSON remains bundled, is emitted as a separate asset, is loaded through `createRequire`, or moves behind a subpath/export, and how schema validation is performed without reintroducing eager load cost.
- Choose one creation-path consolidation target and document the required host-backed accessors for collaboration: sync port, compute bridge, Yrs-state creation, source handles, disposal, and external workbook session registration.
- Convert the verification section into exact gates and ownership: SDK-local commands, cross-package commands for contracts/kernel/types-host/native NAPI, API-extractor review, and a measurable startup/bundle regression check.
- Split adjacent doc/readme drift into a separate follow-up item so the `src` plan remains mechanically executable without silently depending on forbidden or out-of-scope edits.
