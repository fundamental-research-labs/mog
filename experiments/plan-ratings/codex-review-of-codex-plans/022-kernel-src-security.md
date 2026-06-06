Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies the central architectural problem: `kernel/src/security` contains a newer subject/trust/registry model, while the public `@mog-sdk/kernel/security` barrel and production enforcement still mostly run through the older app-ID-based capability service, the capability-gated app API, and a duplicate shell registry. The target architecture is directionally right: make `kernel/src/security` the canonical security contract, migrate enforcement to `CapabilitySubject`, retire duplicate shell semantics, preserve interface-hiding UX, and harden public exports.

The rating is not higher because several security-critical contracts are still described as objectives rather than implementable specifications. The plan needs exact algorithms and compatibility contracts for grant resolution, subject normalization, scope validation, trust-policy decisions, event/audit compatibility, and stored grant migration. For a security enforcement change that spans kernel, shell, app-platform types, public package exports, and UI flows, those details determine whether parallel implementation will compose safely.

Major strengths

- The source diagnosis is accurate and well scoped. It distinguishes the public facade, the older production grant service, the shell registry, gated API enforcement, launch flow, and app-platform type overlap.
- The plan is production-path relevant. It does not stop at `kernel/src/security`; it includes `kernel/src/services/capabilities`, `kernel/src/api/app/capability-gated`, `shell/src/app-launcher`, `shell/src/hooks`, shell permissions/audit UI, and `types/app-platform`.
- The public/private export boundary is treated as a first-class contract. Negative export tests for stores, privileged factories, sensitive handlers, re-auth providers, and bypass policies are exactly the right kind of protection for this subpath.
- The invariants section is unusually useful. Subject matching, empty-subject hazards, negative decisions, implication expansion, scoped operation checks, listener cleanup, and audit metadata are all called out explicitly.
- The verification matrix is broad and mostly aligned with the behavioral risks: subject tests, registry graph tests, grant resolution tests, trust policy tests, gated API tests, shell launch tests, type compatibility, and UI-facing integration checks.
- The sequencing and parallelization notes identify sensible workstreams and dependency direction, which matters because this change spans several packages and runtime surfaces.

Major gaps or risks

- The migration contract is under-specified. The plan says the old app-ID registry should compose over the new grant engine, but it does not define how `ICapabilityRegistry`, `IGrantsStore`, existing grant/denial records, audit entries, event payloads, and shell listeners remain compatible during the migration.
- The grant-resolution algorithm needs to be formal, not prose. The plan names specificity, negative decisions, expiration, scope, and implication, but it does not define a complete ordering for cases like broad allow plus narrow deny, implied allow plus explicit deny of the implied capability, equal-specificity conflicts, expired deny versus active allow, or dependency revocation.
- Subject semantics need more exactness. The plan should define canonical subject constructors, subject-kind derivation, required identity fields, system subject representation, key escaping/collision rules, and how `allowedSubjectKinds` applies to multi-field subjects such as package+app+instance or workspace+tenant.
- Scope contracts remain too loose. The current system has `CapabilityScope` resource matching and managed table ID restrictions; the plan adds JSON Schema validation and scope monotonicity, but it does not define the canonical scope shape, scope normalizer, schema validator, or exact intersection behavior between capability scopes and managed table restrictions.
- Trust policy is correctly promoted from advisory to enforcement input, but the decision API is not specified. It should say whether evaluation takes the package install record plus requested capabilities plus capability metadata, how deny/consent/auto-grant lists are computed, and how this reconciles with the different `types/app-platform` trust shape.
- The handling of `@mog-sdk/kernel/services/capabilities` is still ambiguous. If it remains exported, the plan should pin whether it is public, internal, deprecated, or host-only, and what conformance tests protect that boundary.
- Some verification commands are plausible Jest filters rather than exact existing gates. That is acceptable for a future plan only if the plan also names the test files or conformance suites to add, especially for `sdk-security` and public export tests.

Contract and verification assessment

The contract coverage is above average. The plan identifies most of the right invariants and ties them to production consumers instead of testing an isolated model. The strongest parts are the subject-matching contract, public export boundary, shell duplication removal, operation-time gated API checks, and type-level reconciliation with `types/app-platform`.

The verification plan is also strong, but it should add conformance and migration gates. A shared registry behavior suite should run against the old app-ID adapter and the new subject-aware engine until migration is complete. Storage migration tests should cover memory, SQLite, cloud/tombstone semantics if those stores remain supported. Public export changes should run package build/public type validation in addition to `pnpm typecheck`, because declaration output and export maps are part of the contract. UI-facing launch and permissions changes should include browser/integration checks for consent, denial, revocation, and audit rendering.

Concrete changes that would raise the rating

- Add a canonical security contract appendix before implementation: exact interfaces, subject constructors, subject-kind derivation, key serialization, scope shape, trust decision input/output, audit event schema, and public export map.
- Provide grant-resolution pseudocode plus a truth table covering negative precedence, specificity, expiration, implication/dependency interactions, equal-priority conflicts, and scope conflicts.
- Define the compatibility adapter obligations for `ICapabilityRegistry`, `IGrantsStore`, shell registry consumers, and app-platform types, including event ordering and serialized grant migration from app IDs to subjects.
- Specify capability registry finalization behavior: boot phases, rollback on failed batch registration, duplicate namespace errors, unknown implication/dependency handling, immutable snapshot guarantees, and manifest validation timing.
- Replace broad verification command filters with named test files or suites to add, and include public package build/declaration/export validation for `@mog-sdk/kernel/security`.
- Move shell integration earlier behind a conformance suite so duplicate shell enforcement can be replaced without changing observable launch, settings, audit, and `useAppKernel` behavior accidentally.
