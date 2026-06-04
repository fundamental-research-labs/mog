Rating: 8/10

Summary judgment

This is a strong architectural plan for a high-risk boundary. It correctly treats `kernel/src/bridges/wire` as the production data-plane contract between Rust compute, TypeScript kernel state, viewport coordination, renderer invalidation, and metadata projections. The plan is grounded in real source observations: the packed payload heuristic at byte 30, weak reader validation, lossy delta reconstruction, stale README content, test builders exported from the production barrel, and the unused production role of `mutation-classifier.ts` all match the current code shape.

The plan earns a high rating because it names the right invariants and verification targets instead of proposing local patches. It does not quite reach a 9 or 10 because the most important new contract, the typed packed envelope and validation error model, is still described as intent rather than a concrete schema with exact byte layout, compatibility behavior, error codes, and rollout ordering.

Major strengths

- The plan identifies the real production boundary and follows dependency direction correctly: Rust `compute-wire` remains the schema source of truth, public `mog` code stays independent from `mog-internal`, and TypeScript readers are treated as generated-contract consumers.
- It preserves hot-path architecture instead of replacing binary reads with object materialization or JSON. The explicit callout that `CellAccessor` must stay flyweight and that `ReadonlyBinaryViewportBuffer` remains the consumer surface is important.
- The failure modes are well chosen. The plan covers ambiguous multi-viewport routing, malformed/truncated protocol bytes, stale fetch ordering, mutation overlays during fetches, hydration deficits, section loss in deltas, metadata cache generation leaks, palette drift, and stale force-refresh workarounds.
- Verification is broad and mostly production-path relevant. The proposed tests include malformed protocol inputs, cross-language Rust fixtures, coordinator ordering, full viewport payloads in packed envelopes, delta section preservation, metadata projection behavior, palette field parity, and UI exercises through the real app.
- The parallelization section decomposes the work along sensible seams: Rust schema/constants, TypeScript decoder/routing, buffer refactor, delta merge, coordinator tokens, prefetch/export cleanup, metadata caches, force-refresh audit, and docs.

Major gaps or risks

- The typed envelope contract is the core of the plan, but it is not specified. A worker would still need to invent the exact layout for envelope version, payload kind, viewport id encoding, payload length, flags, reserved fields, checksums or absence thereof, trailing-byte rules, maximum sizes, and legacy decode behavior.
- Validation error handling is underspecified. The plan asks for stable error codes and deterministic recovery, but it does not define the error taxonomy, which errors trigger hydration deficit, which trigger full refresh, which are fatal bridge errors, and how diagnostics avoid corrupting existing buffers.
- The plan is very large for one implementation stream. That is acceptable for an architectural plan, but it needs explicit landing phases and acceptance gates so schema changes, routing changes, delta correctness, metadata cache changes, and barrel cleanup do not block each other or merge in an unsafe partial state.
- Backward compatibility is acknowledged but not resolved. "Keep old-format handling only if production bytes still require it" is too loose for a wire-protocol migration. The plan should say how mixed Rust/TS versions are detected, whether ambiguous packets are rejected or decoded, and when the legacy path is deleted.
- Performance risk is not quantified. Extra validation and section parsing are correct, but this folder is a hot render/mutation path. The plan should state which validation happens once per buffer, which data is cached, what must remain allocation-free per cell read, and what performance regression gate is acceptable.
- Public export changes are directionally right, but the plan does not spell out package export/subpath changes or migration steps for existing internal tests and downstream imports.

Contract and verification assessment

The contract section is the best part of the plan: it names payload kind, wire version failure behavior, little-endian fields, string sentinel semantics, palette ordering, coordinator ownership, fetch overlay precedence, event emission rules, hydration-deficit behavior, inclusive prefetch bounds, metadata cache sync-read guarantees, and barrel export policy. Those are the right contracts to preserve or strengthen.

The missing piece is contract precision. For a binary bridge, prose invariants are not enough. The plan should include a normative table for the packed envelope and each section descriptor, stable protocol error codes, exact offset/length arithmetic rules, maximum count rules, and a compatibility matrix for old Rust writer/new TS reader and new Rust writer/old TS reader during local development.

The verification gates are mostly appropriate and correctly avoid test-only shortcuts. The Jest package command shape appears plausible for `@mog-sdk/kernel`, and the Rust gates target the relevant crates. The plan would be stronger with explicit generated-constant freshness checks, golden fixture regeneration checks, a small performance guard for viewport reads/mutation application, and a named UI scenario file or manual checklist that exercises frozen panes plus full-viewport-in-envelope behavior.

Concrete changes that would raise the rating

- Add a concrete typed-envelope specification: byte layout, version, payload-kind enum, flags, reserved fields, length/trailing-byte rules, size limits, and legacy migration policy.
- Define `BinaryViewportProtocolError` and `BinaryMutationProtocolError` codes up front, with a table mapping each code to recovery behavior, diagnostics, and whether existing coordinator state may be preserved.
- Split the implementation into ordered phases with mergeable acceptance criteria: schema/constants, TS decoder/routing, validation, coordinator tokens, section-preserving delta, metadata cache hardening, export cleanup, force-refresh removals, and docs.
- Add a compatibility/rollout section that explains how Rust and TypeScript changes land together and how old ambiguous payloads are handled during development, tests, and release.
- Specify hot-path performance constraints: one-time validation only, no per-cell allocations, cached section descriptors, and a measurable regression threshold for viewport reads and mutation application.
- Include an explicit traceability matrix from each current weakness to the implementation step and verification gate that closes it.
