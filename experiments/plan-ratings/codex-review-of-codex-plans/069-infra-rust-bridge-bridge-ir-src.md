Rating: 8/10

Summary judgment

This is a strong plan for the `bridge-ir` folder. It correctly identifies that the descriptor DSL should be the single versioned contract between `bridge-core`, `bridge-derive`, and the target macro crates, and it grounds the work in real current gaps: ignored descriptor versions, the `Unknown` source-type fallback, overstated tagged-enum losslessness, duplicated local parsers, and missing cross-target contract tests. The plan is especially good at preserving the target-neutral boundary while still requiring every production consumer to move onto the shared IR.

The main reason it is not a 9 or 10 is that it is still a high-level migration plan in a few places where the risk is in exact adapter contracts. The current targets do not merely duplicate parsing; they encode special behavior: Tauri has a `security_level` preamble and rigid method-body parsing, Delegate consumes `scope`/`needs_principal` and re-emits stripped descriptors, WASM currently rejects direct `structural`, and PyO3 has local tagged-enum lowering. The plan names most of this, but it does not fully pin the expected before/after behavior for each target.

Major strengths

- Correctly treats `bridge-ir` as a normal library crate and a versioned grammar boundary, not as a proc-macro crate or a dumping ground for target policy.
- Accurately covers the real production flow from `bridge-core` descriptor emission through `bridge-ir` parsing and target macro consumption.
- Calls out the two highest-value parser hardening fixes: rejecting unsupported `bridge_version` / `param_struct_version` values and making source identity mandatory.
- Identifies the current tagged-enum mismatch precisely: `bridge-core::VariantField` has a Rust type string, but the emitted DSL and `bridge-ir::VariantField` do not preserve it despite comments claiming losslessness.
- Keeps access-kind semantics correctly split: `Structural` and `Session` remain distinct in shared IR, while target adapters may collapse them explicitly.
- Includes a credible cross-target golden corpus rather than relying only on hand-written unit parser strings.
- Includes useful parallelization boundaries across bridge-ir, bridge-core, target macro migration, bridge-derive, and shared fixtures.

Major gaps or risks

- The target adapter behavior needs a sharper matrix. For each target, the plan should say exactly how `Pure`, `Read`, `Write`, `Structural`, `Session`, lifecycle create, lifecycle create-from, `scope`, `needs_principal`, `extras`, `skip`, async, and tagged enums map after migration. This matters because current target behavior is not uniform.
- The WASM structural decision is under-specified. Current WASM macro tests assert that direct `method structural` remains unsupported, while the plan says structural may collapse to write-like "where appropriate." The plan should decide whether migration changes WASM behavior, preserves the rejection in the adapter, or requires bridge-core/delegate to avoid direct WASM structural descriptors.
- Delegate migration is riskier than the plan makes it sound. Delegate is both a descriptor consumer and a descriptor producer; it validates gated `scope` and `needs_principal`, strips private engine-only facts, and re-emits public descriptors. The plan should specify re-emission snapshots before changing its parser.
- Tauri's `security_level` preamble is mentioned, but the plan should also require tests that prove the preamble can be parsed and removed before handing the standard descriptor body to `bridge-ir`.
- The plan leaves `group` optional with an "if real production caller still emits" branch. For a hardening plan, this should be resolved by an explicit inventory before implementation begins.
- The snapshot/equality section is directionally right but may overreach. Deriving `PartialEq`/`Eq` on every IR type is not equally valuable if some fields are `syn::Type`; deterministic comparison helpers and explicit snapshot structs may be a cleaner contract than broad trait derivation.
- Param-struct coverage is good, but the plan should align with current `bridge-derive` behavior more directly: the derive layer does not emit `[parse]` or `[tagged_enum]` today, so tests should distinguish "parser accepts contract grammar" from "derive can emit this category."

Contract and verification assessment

The contract framing is the plan's best part. It clearly separates emitted descriptor facts from target-specific lowering, preserves dependency direction, rejects compatibility shims around stale shapes, and asks for diagnostics at the bridge contract boundary. It also correctly treats `extras` as deterministic target-neutral metadata and keeps target preambles out of `ApiDescriptor`.

The verification gates are mostly appropriate: `cargo test -p bridge-ir`, `cargo clippy -p bridge-ir`, all target macro crate tests/clippy runs, bridge-core and bridge-derive tests, and production bridge crates are the right family of checks. The plan also includes contract-specific tests for unsupported versions, missing mandatory headers, bridge-core emission round trips, cross-target snapshots, tagged-enum preservation, param-struct eligibility, access lowering, skip handling, and extras ordering.

The main verification gap is sequencing. The plan should say which gates must pass after each migration slice, not only after the whole effort. In particular, bridge-ir hardening should have negative parser tests before target migrations; each target migration should include adapter equivalence snapshots against its old parser behavior; Delegate should have both gated behavior tests and re-emitted descriptor shape tests; and compute binding tests should run only after the macro crates compile on the shared corpus.

Concrete changes that would raise the rating

- Add a per-target adapter contract table covering every shared IR field and whether the target consumes, ignores, rejects, strips, or re-emits it.
- Resolve the `group` and WASM `structural` questions before implementation, with explicit acceptance criteria and migration tests.
- Add a Delegate-specific subsection for consuming shared IR, validating gated-only fields, stripping engine-only facts, and re-emitting public descriptors with snapshots.
- Specify that migration tests compare old local-parser output to new `bridge-ir` adapter output for each target before deleting local parsers.
- Define the exact descriptor golden corpus schema and where generated-vs-handwritten fixtures live, so the corpus does not become another set of ad hoc strings.
- Add staged verification gates after each worker slice, including which target macro tests are expected to fail until a dependency slice lands.
- Replace broad "derive `PartialEq`/`Eq` everywhere" with a concrete snapshot/comparison contract for `syn::Type` fields and adapter-visible normalized type strings.
