Rating: 7/10

Summary judgment

This is a strong contract-hardening plan in the areas it actually inspects: it identifies real security-relevant defects in `fingerprints.ts`, real drift risks in proof construction, real misuse risks from unbranded identifiers and `unknown` handles, and real public-surface/versioning gaps. The plan is weakest where a plan for boundary contracts must be strongest: production-path relevance and migration scope. Its central evidence claim that `@mog-sdk/types-host` has zero external consumers is false in the current tree. Kernel, `@mog/kernel-host-internal`, runtime SDK/test-host/embed, and shell already import and execute against these contracts, and `validateKernelHostContextForDocument` plus `DocumentLifecycleSystem` already consume `KernelDocumentLifecycleInput`. That stale premise makes the sequencing, “breaking changes are cheap,” and verification gates materially under-specified.

Major strengths

- The canonicalization/fingerprint critique is concrete and important. The current implementation does collapse or mishandle `undefined`, non-finite numbers, functions/symbols, and non-JSON values while advertising `jcs-rfc8785`; the plan correctly treats this as the highest-priority runtime security issue.
- The plan correctly notices that `blake3` is accepted by the type/regex surface but not produced by `createHostCanonicalFingerprint`, which is a contract/verifier mismatch.
- It does a good job preserving existing invariants: literal `false` raw-byte guards, single-use source handles, replay registry semantics, Rust-gated workbook access, and trusted/untrusted structural disjointness.
- The type-surface hardening goals are directionally right: branded ids, named provider/storage-scope shapes, principal unification, a curated barrel, and protocol/version typing would all reduce boundary misuse.
- The test section targets meaningful properties rather than only compilation: negative canonicalization cases, regex cases, covered-field/payload agreement, digest sensitivity, and brand/disjointness checks.

Major gaps or risks

- The “zero external consumers” evidence is wrong. Current consumers include `mog/kernel/src/api/workbook/workbook-impl.ts`, `mog/kernel/src/document/*`, `mog/kernel/host-internal/src/*`, `mog/runtime/sdk/src/host-adapters/node-headless-host.ts`, `mog/runtime/test-host/src/*`, `mog/runtime/embed/src/host-adapters/*`, and `mog/shell/src/host-adapters/standalone-browser-host.ts`. Any breaking rename, id branding, canonicalization change, or export map change needs a coordinated migration plan across those packages.
- The claim that the trusted adapter factory / validation gate “appear absent” is also wrong. `@mog/kernel-host-internal` has `validateKernelHostContextForDocument`, validates bindings/replay/storage/provider joins, and constructs `KernelDocumentLifecycleInput`. The plan should integrate with that package instead of treating it as a future follow-on.
- The verification gates are too narrow. `pnpm --filter @mog-sdk/types-host typecheck` and `test` are necessary, but insufficient for this plan. At minimum the plan needs gates for `@mog/kernel-host-internal`, `@mog-sdk/kernel`, `@mog-sdk/runtime-sdk`, `@mog-sdk/runtime-test-host`, and shell adapter tests or package typechecks that exercise the existing host path.
- Step 2 focuses on moving test proof helpers into production, but existing production consumers already build fingerprints and proof-like payloads ad hoc. The plan should inventory and replace those call sites, otherwise the new production proof builders will coexist with divergent production hashing logic.
- Step 3 overstates what can be enforced by TypeScript alone. A branded factory signature does not make `as unknown as TrustedDocumentHostContext` impossible; TypeScript cannot reject double assertions without lint/API-boundary rules or moving the construction surface behind an actual constructor/token discipline plus import-boundary enforcement. The proposed `expect-error` for an `as unknown` construction is not a valid type-level gate.
- The canonicalization requirements are not quite internally crisp. It says to reject `undefined` while also saying object-property `undefined` should be dropped JCS-style. The plan should define the accepted JSON value domain, array handling, object handling, number formatting, and sync/async hash-provider API precisely before implementation.
- The package export-map assessment misses that `src/source.ts` exists but there is no current `./source` subpath export. Any “per-module subpath” cleanup should explicitly decide whether to export it or keep it internal.

Contract and verification assessment

The contract goals are mostly well chosen, but the plan needs a production contract matrix: each exported type/runtime function, each current consumer package, whether the change is additive or breaking, and which consumer must change in the same slice. Without that, the plan could produce a locally clean `types-host` package while breaking the host-backed document path that already exists.

The fingerprint work should be specified as a wire-format migration. If `mog-host-fp:v1` digests change, the plan must say whether existing production/test adapters are migrated to `v2`, whether old `v1` verification remains accepted, and how call sites that compare fingerprints in kernel preflight/import/operation gates are updated. The current plan notices this risk but still treats the blast radius as near-zero because of the incorrect no-consumer premise.

Verification should include the `types-host` tests/typecheck plus host-internal validation tests, kernel host lifecycle/operation/import/preflight tests, and typechecks for the runtime and shell adapters that construct branded contexts and bindings. If id branding or export changes land, API/import-boundary checks should be included as well.

Concrete changes that would raise the rating

- Replace the stale “zero consumers / absent validation gate” section with an inventory of all current imports and a migration table for kernel, host-internal, runtime SDK, test-host, embed, and shell.
- Add a sequencing plan that first centralizes canonical fingerprint/proof builders, then updates all production call sites, then changes the format/version label, then tightens identifiers and exports.
- Define the canonical JSON domain precisely, including object-property `undefined`, array `undefined`, non-finite numbers, `-0`, bigint/symbol/function rejection, Unicode escaping, and whether the hasher API remains synchronous.
- Replace the brand-enforcement step with a realistic mechanism: construction helper/token plus import-boundary/lint/API checks, and tests that verify those checks rather than impossible TypeScript rejection of double assertions.
- Broaden verification gates to include current production consumers and host-backed lifecycle behavior, not only the `@mog-sdk/types-host` package-local gates.
- Decide explicitly whether `./source` should become an exported subpath and update the export-surface plan accordingly.
