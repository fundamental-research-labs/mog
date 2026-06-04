Rating: 8/10

Summary judgment

This is a strong, production-aware plan for a security-sensitive type shard. It correctly treats `types/host/src` as the contract boundary for trusted adapters, kernel host validation, source/storage handoffs, runtime bindings, embed protocol shape, diagnostics, and fingerprint proofs. The plan is grounded in the current source: root `index.ts` does re-export trusted types, `/untrusted` is currently only a placeholder, trusted adapters use broad branded casts, iframe bootstrap currently casts a null kernel into `TrustedDocumentHostContext`, binding registries still use `unknown` and stringly fields, and canonical fingerprinting is generic despite being used in production gates.

The rating is not higher because the plan leaves several critical contract decisions as implementation-time choices. For a boundary-hardening effort, the exact untrusted protocol mapping, fingerprint versioning/domain payload shape, construction authority enforcement mechanism, and leak-check commands need to be specified more tightly before parallel implementers start changing multiple packages.

Major strengths

- The plan has excellent production-path relevance. It connects the type shard to `kernel-host-internal`, kernel storage/import/operation gates, shell and SDK host adapters, runtime test host, and iframe/embed boundary code rather than treating this as a type-only cleanup.
- The security invariants are explicit and useful: no raw bytes over untrusted boundaries, nonce consumption before materialization, expiry fail-closed semantics, exact tenant/workspace markers, provider/source/principal joins, process timezone prohibition, and diagnostics redaction.
- The root export-surface issue is correctly identified and paired with package exports, import-boundary rules, external negative fixtures, and declaration leak checks.
- The trusted/untrusted split is architecturally sound. Separating protocol/bootstrap host context from fully kernel-backed document host context directly addresses the current iframe `kernel: null as unknown` problem.
- The verification section is broader than ordinary typecheck-only plans and names package-level behavior gates for type-host, kernel validation, adapters, SDK, shell, embed, test host, import-boundary, external fixtures, and public declaration leakage.
- The parallelization notes are plausible and mostly respect package boundaries, with clear tracks for export surface, fingerprints, trusted/untrusted contracts, bindings/lifecycle typing, adapter migration, and diagnostics.

Major gaps or risks

- The untrusted protocol contract is still underspecified. The plan names envelope/request/response/policy types, but it does not map current `runtime/embed/src/iframe/protocol.ts` message kinds to the proposed `/untrusted` contracts, define compatibility with protocol version 1, or state whether this is a breaking protocol migration.
- Fingerprint migration needs a sharper contract. The plan says to add purpose/domain separation and maybe rename canonicalization away from RFC 8785, but it does not define the new fingerprint version string, the exact domain-separated payload shape, canonical rejection behavior for edge values, or whether existing `mog-host-fp:v1:*` fingerprints remain accepted during migration.
- Construction authority is only partially enforceable as written. Exporting `createTrustedDocumentHostContext` from `/trusted` plus lint boundaries is better than scattered casts, but the plan should also add a mechanized ban or fixture for direct `as unknown as TrustedDocumentHostContext` outside the constructor path.
- The proposed primitive branded IDs are directionally good, but the plan does not specify which values are runtime-validated at untrusted ingress versus merely aliased at compile time. Without that split, implementers may add nominal-looking types without improving boundary safety.
- The operation/lifecycle refactor is large and could churn public subpath internals. The plan says to preserve subpath compatibility, but it should define the exact barrel/export compatibility contract before file splitting begins.
- Some verification gates are described generically rather than as runnable commands, especially import-boundary tests, external negative fixtures, declaration leak checks, and publish-readiness checks. This weakens the handoff for implementers and reviewers.
- The sequencing still risks cross-track conflicts. Fingerprint helper changes, diagnostics event shape changes, binding discriminants, and adapter migrations all touch the same production files; the plan should pin the base contract changes first and require adapters to migrate against one frozen type surface.

Contract and verification assessment

Contract clarity is high for invariants and production responsibilities, but medium for exact schemas. The plan does a good job enumerating what must never cross the untrusted boundary and what validated handoffs must carry. It is less precise about concrete discriminated union shapes, versioning, compatibility, and acceptance criteria for the new exported helpers.

Architecturally, the plan fits the repository direction: `types-host` remains private, `mog` does not depend on internal content, host adapters stay the trusted composition roots, runtime enforcement remains in adapters/kernel gates rather than moving into a type package, and public SDK/embed leak checks stay mandatory.

Verification coverage is strong in breadth. The plan correctly avoids stopping at typecheck and includes behavior tests for kernel gates and adapters. The missing piece is exact command-level verification for boundary tooling and declaration leakage, plus negative tests that fail if trusted construction casts are reintroduced.

Concrete changes that would raise the rating

- Add an explicit `/untrusted` protocol migration table: existing embed message type, new host-boundary request/response type, authoritative origin/nonce fields, allowed payload fields, redacted policy fields, and compatibility behavior for protocol version 1.
- Define the fingerprint contract precisely: version string, purpose enum, domain-separated canonical payload schema, byte-hash format, parser behavior, migration behavior for existing fingerprints, and field-set fixtures for every proof helper.
- Specify a lint or type-test gate that forbids `as unknown as TrustedDocumentHostContext` except inside the source-owned constructor implementation and explicitly named legacy tests during migration.
- Convert the generic verification bullets into runnable commands, including the import-boundary test command, external fixture command, SDK/embed declaration leak command, and the appropriate publish-readiness script.
- Add an ordered integration sequence: freeze export/primitives/fingerprint/protocol contracts first, then migrate kernel validation, then adapters, then diagnostics/logging, then public leak and negative fixtures.
- For branded primitive IDs, state which constructors/validators exist, which inputs they accept, and where runtime validation is required versus where a plain alias is sufficient.
