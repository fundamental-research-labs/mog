Rating: 7/10

Summary judgment

This is a serious, evidence-backed plan for hardening `contracts/runtime-services/src`. It correctly identifies the main local problems: duplicated runtime error/audit/deployment declarations, security-sensitive `Record<string, unknown>` fields whose redaction promises are only prose, unbranded identifiers, divergent principal shapes, and no type-level tests. It also respects the critical type-only / not-a-server charter.

The rating is held back by architectural ambiguity. The plan recommends making the private `@mog-sdk/runtime-service-contracts` package canonical and having `@mog-sdk/contracts` re-export from it, but the repo classifies `@mog-sdk/contracts` as shipped public and `@mog-sdk/runtime-service-contracts` as workspace-internal/private. Without a precise public/private dependency rule, that can leak private package references into public declarations or conflict with Plan 002's canonicalization decision.

Major strengths

- Strong source evidence. The plan's findings line up with the current files: `ServicePrincipal`, `AuditActor`, decision refs, timestamps, room scopes, MIME/format/provider fields, and service names are open strings; `RuntimeErrorEnvelope.details`, `RuntimeAuditEvent.redactedMetadata`, and `ServiceDiagnostics.config` rely on prose-only redaction requirements; `contracts/src/runtime` duplicates key shapes.
- Good contract-first framing. It focuses on making invalid states harder to express rather than adding runtime service behavior, and it explicitly preserves the documented "private/type-only contracts, not a shipped server" posture.
- Correctly treats duplication as a single-source-of-truth problem rather than local cleanup. The required coordination with Plan 002 is called out, including build-cycle risk.
- Verification expectations are directionally strong: branded-ID negative tests, redaction-brand tests, error-envelope correlation tests, barrel completeness, cross-package drift guards, package typecheck, workspace build, lint, and security-doc consistency.

Major gaps or risks

- The canonical ownership decision is too assertive for the evidence. The plan says `runtime-services` should be canonical, but current docs and inventory say it is workspace-internal/private while `@mog-sdk/contracts` is shipped public. If `contracts` re-exports from this package, emitted `.d.ts` files may expose a private package dependency unless the plan also makes `runtime-service-contracts` public or keeps the public package self-contained.
- The plan conflicts with the coordination shape implied by Plan 002. Plan 004 says "canonical here"; Plan 002 says the two plans must first choose a canonical home and even suggests Plan 002 own that decision. That needs to be resolved before either plan is implementable.
- Closed unions for `service`, `providerType`, `outputFormat`, and room scopes are under-specified. The repo currently says no supported service distribution is shipped, so a plan should require enumerating actual existing/future producer vocabularies or deliberately use `Known | (string & {})` extension types. Otherwise it risks freezing speculative values.
- The brand-constructor and redactor-signature language is risky in a type-only package. `export declare function`-style signatures can look like runtime exports even though no implementation exists. The plan should specify type-only factory interfaces or trust-boundary casting patterns clearly, and prohibit value imports that would fail at runtime.
- Compatibility is acknowledged but not operationalized. Renaming `AuditActor.actorType` to `principalType`, narrowing strings, and branding fields are source-breaking for unseen out-of-repo services. The plan needs an explicit migration/versioning matrix per field, not just a general warning.

Contract and verification assessment

The contract goals are mostly right: redaction, identity nominal safety, decision-ref consistency, principal unification, error correlation, scope vocabulary, and single-source-of-truth all target real boundary risks in the current source. The best part of the plan is that it proposes type-level tests for negative cases, which is the right verification style for a type-only package.

The verification section still needs package-boundary gates. Add checks that public `@mog-sdk/contracts` declaration output does not reference private packages unless `@mog-sdk/runtime-service-contracts` is intentionally made publishable. Also tie the proposed type tests to the repo's actual tooling: either add the required `tsd` dependency and scripts, or use the existing TypeScript/expect-type style already present in the workspace. The plan should name the exact scripts to add to `contracts/runtime-services/package.json` and the exact root gates that catch private leaks and declaration drift.

Concrete changes that would raise the rating

- Start with a mandatory Phase 0 decision: canonical public home, private/internal home, or publish `@mog-sdk/runtime-service-contracts`. State the allowed dependency direction and the expected emitted declaration shape.
- Reconcile Plan 004 with Plan 002 explicitly: one plan owns the canonical-home decision, the other consumes it. Do not let both plans independently choose different homes.
- For every proposed closed union, list the evidence source for allowed values and decide whether it is closed, extensible (`Known | (string & {})`), or deliberately branded open string.
- Replace "constructor signatures" with a type-only-safe pattern: exported brand types, parser/redactor function type aliases, and documentation that implementations live outside this package.
- Add a field-by-field compatibility table covering `actorType` rename, branded IDs, timestamp brands, decision refs, redacted payloads, and error-envelope union narrowing, with version bump expectations.
- Add explicit private-leak/declaration gates: `check:private-leaks`, declaration identity/rollup checks where applicable, and a test proving `@mog-sdk/contracts` does not emit private package references unless that is the chosen publish strategy.
