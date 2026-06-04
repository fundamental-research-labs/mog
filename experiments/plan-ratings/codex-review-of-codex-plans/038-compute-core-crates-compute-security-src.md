Rating: 8/10

Summary judgment

This is a strong security-hardening plan for `compute-security`. It correctly treats the crate as a pure policy/redaction domain layer, identifies the real production consumers in `compute-core`, `compute-api`, `compute-wire`, and `bridge-delegate`, and focuses on enforcement contracts rather than isolated cleanup. The plan is especially good at recognizing that the current risky surfaces are systemic: permissive policy/tag construction, non-canonical `Principal::from_tags`, flat generic range redaction, incomplete bridged-return classification, binary/render payload leakage, and audit gates that still allow manual-review gaps.

The main reason it is not a 9 or 10 is that it reads more like a comprehensive roadmap than an immediately executable implementation contract. Several major items name the right destination but do not yet pin the exact accepted behavior, migration semantics, public API compatibility choices, or phased landing order needed to keep such a broad security change verifiable as it lands.

Major strengths

- Correct architectural fit: the plan preserves `compute-security` as a pure crate and explicitly keeps Yrs, storage state, bridge dispatch, SDK transport, and host principal sessions in their existing integration layers.
- Strong production-path relevance: it does not stop at unit tests. It follows enforcement through `SecurityState`, bridge delegate codegen, public bridge calls, viewport buffers, screenshots, sync bytes, template application, and event relays.
- Good preservation of existing contracts: it calls out stable `AccessLevel` ordering, default owner/default deny behavior, target specificity, tag specificity, priority ordering, ambiguity warnings, disabled policies, owner-lockout, column identity resolution, and matrix cache identity constraints.
- Systemic coverage mindset: instead of patching one redaction gap, it proposes a complete payload classification model and stricter audits so new bridged reads cannot silently join the surface unclassified.
- Verification gates are broad and mostly well matched to blast radius: `compute-security`, `compute-api`, `compute-core`, `bridge-delegate`, and `compute-wire` are all included when relevant.
- The plan is grounded in current source facts. Examples confirmed in source include permissive `TagMatcher::parse`, non-canonical `Principal::from_tags`, flat `filter_range_values(&mut [T])`, bridge macro detection based on `return_ty_str.starts_with("Vec<")`, production `wb_security_apply_template` still calling `Template::generate()`, and coverage audits that still include non-failing/manual-review redaction classifications.

Major gaps or risks

- Scope is very large for one plan. Validation, principal identity typing, redaction traits, bridge macro changes, return-type registry, binary enforcement, engine indexing, diagnostics, template provenance, event unification, audits, fuzzing, and performance gates are all substantial. The plan needs milestone boundaries with explicit invariants after each landing step.
- The validation contract is under-specified. It lists tag grammar, wildcard placement, reserved tags, priority bands, timestamp bounds, template IDs, duplicate IDs, and target-specific fields, but does not define the exact grammar, allowed reserved-tag sources, timestamp range, duplicate handling, or skip-vs-reject behavior per entrypoint.
- Data classification is conceptually right but not yet executable. It should include an actual inventory table of bridged read return types with one required classification, minimum access level, redaction behavior for `None` and `Structure`, and whether the method denies before dispatch.
- Public API compatibility decisions are not pinned. Some fixes may require fallible signatures, changed return shapes, blank renders, or denied binary reads. The plan says those may be needed but does not decide which endpoints must change and what SDK-visible behavior is acceptable.
- Migration and legacy persisted-policy behavior needs sharper definition. "Skip invalid policies fail-closed and emit diagnostics" is directionally right, but implementers need a precise policy for malformed persisted rows, duplicate IDs, invalid reserved tags, stale targets, and template-band collisions.
- Diagnostics need audience and safety contracts. The plan asks for richer denial and anomaly events, but should specify which fields are visible to denied principals, owners/admins, local debug surfaces, and SDK event consumers so policy structure does not leak.
- Engine indexing needs an equivalence contract beyond "preserve semantics." It should define a golden comparison strategy for scan-vs-indexed resolution and matrix output, including ambiguity ordering and explanation ordering, before replacing the resolver.
- Performance goals are deferred appropriately, but lack baseline metrics or thresholds. Without target sizes and acceptance criteria, the performance portion can only prove "benchmarks exist," not "production path improved without regression."

Contract and verification assessment

The verification section is one of the better parts of the plan. It correctly requires crate-level Rust tests and clippy for `compute-security`, then expands to `compute-api`, `compute-core`, `bridge-delegate`, and `compute-wire` when the production path changes. It also explicitly asks for bridge E2E coverage through public calls, compile-fail or hard audit tests for unclassified range reads, property tests for resolver/matrix equivalence, serde fixtures for invalid policy JSON, and production-path performance checks after semantic hardening.

The missing piece is that many of the proposed tests cannot be written cleanly until the plan turns its intended contracts into tables or enums. In particular, validation outcomes, bridged return classifications, binary/render policies, and event visibility rules need to be specified before verification can be unambiguous. The current audit tests already show why this matters: some redaction gaps are printed or stabilized as known sets rather than failing as complete contracts.

Concrete changes that would raise the rating

- Split the plan into sequenced phases with a required green state after each phase: validation, principal canonicalization, shape-aware redaction, bridge classification/audits, binary/render enforcement, resolver indexing, diagnostics/events, templates, fuzz/perf.
- Add a normative validation spec: exact tag grammar, matcher grammar, reserved-tag rules, priority-band ownership, timestamp/id constraints, duplicate policy behavior, malformed persisted policy handling, and which APIs reject vs skip with diagnostics.
- Add a bridged-read classification matrix generated from the bridge descriptor inventory, with one row per method/return type and explicit `None`, `Structure`, `Read+`, and deny-before-dispatch behavior.
- Decide the binary/render endpoint policy up front: for each `Vec<u8>`/`Bytes` method, state whether it is viewport-redacted, workbook-read-denied, blank-rendered, rendered from redacted data, or converted to a fallible API.
- Define event visibility and redaction rules for diagnostics by recipient class, including what a denied non-owner may learn about policies, targets, principals, and conflicting rules.
- Specify resolver-index equivalence tests as a required migration harness before changing the implementation path, including scan/index differential cases for scalar `evaluate`, `explain`, and `evaluate_sheet`.
- Add concrete performance baselines and target workloads for policy count, tag count, sheet width, range size, viewport buffer size, and screenshot/render denial paths.
