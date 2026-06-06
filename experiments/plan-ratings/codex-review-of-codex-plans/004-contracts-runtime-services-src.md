Rating: 8/10

Summary judgment

This is a strong plan for `mog/contracts/runtime-services/src`. It correctly treats the package as a reserved, private contract surface rather than a shipped service API, and it grounds the proposed work in the real host/kernel authorization path instead of inventing a parallel service story. The diagnosis is well supported by the current source: `ServicePrincipal`, `TenantScope`, room/import/export/raw-byte handoffs, protocol handshakes, health/readiness, audit events, and error envelopes are mostly string-heavy type declarations, while the production host path already has verified principals, sentinel tenant/workspace scopes, decision ids, correlation ids, nonces, epoch-ms expiry, fingerprints, raw-byte policy, source identity, high-water proofs, and export materialization grants.

The main reason this is not a 9 or 10 is that the plan defers the most important architectural decision: which package actually owns each canonical contract. It describes the right decision space, but it does not choose an ownership model or define exact dependency rules for public packages like `@mog-sdk/node`, shell adapters, kernel types, and `@mog-sdk/contracts`. For a contracts package, that unresolved source-of-truth choice is not a detail; it is the thing that determines whether implementation composes cleanly.

Major strengths

- Correctly preserves the reserved/private boundary. The plan avoids proposing an HTTP service, OpenAPI schema, deployment manifest, or public self-hosting API, and it explicitly calls out docs and package inventory as part of the contract.
- Excellent production-path relevance. It compares the weak runtime-service contracts against `@mog-sdk/types-host` and `kernel/src/document/host-operation-gate.ts`, where authorization handoffs are actually generated, checked, expired, and nonce-consumed.
- Good security-contract instincts. The plan identifies verified principals, sentinel tenant/workspace scopes, replay nonces, raw-byte materialization, source content identity, redaction, export proofs, and decision causality as first-class contract requirements.
- Good duplicate-drift diagnosis. `contracts/src/runtime/error-envelope.ts` and `audit-event.ts` duplicate the runtime-services shapes, and `service-config.ts` overlaps deployment/profile/redaction vocabulary. The plan correctly says this must become one source of truth rather than two editable copies.
- Verification is much better than a typecheck-only plan. It calls for type fixtures, negative `@ts-expect-error` cases, declaration/import-boundary checks, package disposition checks, and behavior gates through real host authorization paths.
- The sequencing is broadly sensible: decide canonical ownership, strengthen principal/scope/handoff bases, align with host operation gate, then migrate consumers and docs.

Major gaps or risks

- The canonical ownership decision is left open. The plan says to choose among `runtime-services`, `contracts/src/runtime`, or a neutral lower-level shard, but a plan for contract cleanup should propose the default ownership model and explain why. Without that, implementers can make mutually incompatible choices.
- It risks making a private package too central to public production packages. Updating shell, runtime SDK, kernel, and test-host adapters to "produce the canonical handoffs" is right in spirit, but the plan needs stricter rules for whether those public packages may import `@mog-sdk/runtime-service-contracts` at all, and whether those imports can appear in emitted declarations.
- It does not provide concrete target type sketches for the most important new contracts. The required fields are listed, but exact discriminants, branded id aliases, projection boundaries, and raw-byte union shapes are not specified enough to prevent divergent implementations.
- Runtime value exports are treated as optional, but the consequences are under-sequenced. If protocol helpers are added, the package stops being type-only and must get explicit runtime import tests, JS output expectations, package description changes, and inventory updates in the same slice.
- The migration scope is large and may conflate contract design with consumer adoption. The plan would be stronger if it split "pin canonical types and fixtures" from "update adapters to use them" with explicit acceptance criteria at each boundary.
- Documentation work is well identified but not specific about exact claims to preserve. The current docs already say "reserved / not shipped"; the plan should require wording that continues to distinguish same-process Node SDK automation, host-owned browser integration, private service-boundary types, and any future service distribution.

Contract and verification assessment

The contract assessment is the strongest part of the plan. It correctly identifies the current service contract weaknesses: raw string principals, optional workspace/document scope, ISO expiry for security-sensitive grants, ambiguous free-string decision refs, no nonce/replay base, weak import/export/raw-byte materialization records, and an unsafe "empty MIME allowlist means all" rule. It also correctly points to the stronger existing production contracts in `types/host/src/kernel.ts`, `identity.ts`, `source.ts`, and `diagnostics.ts`.

The verification plan is broad and mostly appropriate. Package-local contract fixtures, negative type tests, declaration leak checks, runtime inventory checks, and real host/kernel behavior verification are the right gates for this kind of work. The plan also correctly rejects test-only authorization bypasses. The missing piece is sharper pass/fail criteria: for example, exactly which public entrypoints must compile without private declaration leaks, exactly which handoff fields must be asserted by fixtures, and exactly which replay/expiry behavior must be exercised for export/import/raw-byte flows.

Concrete changes that would raise the rating

- Choose a recommended ownership model up front. For example: host/kernel authorization handoffs remain canonical in `@mog-sdk/types-host`; runtime-service contracts either re-export serializable projections or define strictly service-only envelopes; public `@mog-sdk/contracts` duplicates become re-export shims or move to a neutral public-safe shard.
- Add exact dependency rules: which packages may import `@mog-sdk/runtime-service-contracts`, whether imports must be type-only, and which public declarations must be proven free of private package references.
- Include target type sketches for `RuntimeServicePrincipal`, `RuntimeServiceResourceContext`, `RuntimeServiceHandoffBase`, `RuntimeRawByteMaterializationDecision`, protocol compatibility helpers, and audit/error event phases.
- Define acceptance fixtures by name: weak principal rejection, sentinel scope preservation, epoch-ms expiry rejection of ISO strings, denied raw-byte decisions with no grant fields, granted raw-byte decisions with explicit MIME policy, export grant alignment with `HostExportMaterializationGrant`, and protocol compatibility cases.
- Split implementation into two milestones: first canonical ownership plus pinned contract fixtures, then consumer migration through shell/runtime SDK/kernel/test-host with behavior verification.
- Make the docs update concrete by listing the exact reserved-service claims that must remain true and the exact files whose wording must be checked.
