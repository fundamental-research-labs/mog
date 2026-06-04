Rating: 8/10

Summary judgment

This is a strong plan for `mog/compute/api/src`. It correctly treats the folder as a public API boundary rather than a collection of facade wrappers, and it ties the Rust `Workbook`/`Sheet` API, `ComputeService`, bridge descriptors, binding crates, generated TypeScript metadata, and SDK behavior into one contract surface. The plan is production-path relevant and matches the observed source: `ComputeService` is the generated bridge facade, `compute-core` default features are intentionally disabled, several ergonomic facade modules are placeholders, some boundary inputs are still loose strings or `serde_json::Value`, address numeric paths pass through without bounds checks, and mutation-result extraction is repeated across sub-APIs.

The main weakness is that the plan is still too broad to be directly executable as a single implementation contract. It names the correct systematic work, but it does not define the exact contract-matrix schema, source-of-truth precedence, generated artifact command, public compatibility policy, or per-slice acceptance criteria tightly enough to prevent divergent implementations.

Major strengths

- The architectural framing is right: `compute-api` is the boundary around the engine, not the place to duplicate compute-core domain models or hand-write parallel binding surfaces.
- The plan prioritizes auditable contracts before broad implementation, which is the right sequencing for a folder whose consumers span Rust facade tests, WASM, N-API, PyO3, kernel transport, and SDK surfaces.
- The observed gaps are real. The source includes placeholder modules for workbook protection, workbook styles, sheet hyperlinks, sheet pivots, and `pure::solver`; loose inputs in clear modes, calculation modes, structures, formats, filters, charts, and objects; repeated `(_vp, mutation)` extraction; and an unchecked native dispatch downcast.
- The production invariants are concrete and valuable: one `ComputeService` bridge surface, target-specific dispatch semantics, stable `ComputeApiError` wire shape, security principal session locality, viewport patch preservation, and no private/internal dependency leakage.
- Verification expectations are much stronger than compile-only checks and include contract tests, binding surface tests, generated artifact freshness, and behavior through public read paths.

Major gaps or risks

- The inventory step needs a precise schema and source-of-truth rules. "Owner, scope, operation kind, input/output types, bridge groups, consumers" is a good start, but the plan should define stable keys, how macro-expanded methods are discovered, how Rust facade methods map to engine descriptors, and how intentional omissions are represented.
- "Implement every engine-supported workbook/sheet operation" is correct directionally but underspecified as an acceptance contract. It should enumerate categories and disposition states, or require the initial inventory PR to generate the complete task list before facade work begins.
- The typed-input migration is high risk without a compatibility and call-site migration policy. The plan rejects compatibility shims, which is often right here, but it should say whether public Rust API breakage is acceptable, how generated bindings map old JSON payloads to new typed structs, and what release/deprecation path applies to SDK consumers.
- The PyO3 parity section is evidence-backed, but it needs a stronger definition of "parity". Descriptor group parity, Python public API parity, and generated `api_surface` disposition parity are different contracts and should be tested separately.
- Dispatch lifecycle hardening is useful but less connected to the main contract inventory. It may deserve its own slice after the API surface audit unless the inventory reveals dispatch-specific production failures.
- The generated freshness gate is underspecified. It names generated files but not the canonical generation command, expected working directory, or whether the gate compares checked-in output, build output, or test fixtures.
- The plan references many adjacent folders, but it does not draw a clear boundary between changes owned by this plan and dependent follow-up plans in compute-core, rust-bridge, binding crates, kernel, and SDKs.

Contract and verification assessment

The contract instincts are excellent. The plan asks for negative-drift tests across bridged engine methods, facade coverage, security scope, binding descriptor lists, Python dispositions, error wire shape, address/range behavior, and generated artifacts. That is the right kind of verification for an API boundary.

The verification gates are broad enough, but they need to be tied to slices. For example, a pure address/range validation slice should run `cargo test -p compute-api` plus the relevant property tests, while descriptor changes need WASM/N-API/PyO3 generation and kernel metadata tests. As written, the gate list risks becoming a large checklist that agents run inconsistently rather than a contract tied to each implementation step.

The plan also needs explicit tests for the production bridge path, not only Rust facade methods. It mentions WASM/N-API smoke and TypeScript bridge tests, but should specify at least one end-to-end generated-command path that verifies argument serialization, error shape, viewport patch preservation, and session principal behavior through the actual transport layer.

Concrete changes that would raise the rating

- Add the exact contract matrix schema, including stable method id, source descriptor id, facade path, bridge descriptor group, binding target exposure, security scope, mutation result shape, viewport patch disposition, input contract type, output contract type, and test coverage/disposition fields.
- Make step 1 produce a checked-in inventory and failing audit with the complete generated backlog before any facade completion work begins.
- Split the implementation into named slices with acceptance criteria: inventory/parity, address and value semantics, typed-input conversions, facade category completion, bridge binding parity, dispatch lifecycle, and generated docs.
- Define the public migration policy for replacing string/JSON inputs with typed structs, including whether old Rust methods are removed, renamed, or temporarily wrapped, and how SDK/generated bindings adapt.
- Specify the canonical bridge generation/freshness command and the exact files it must compare.
- Separate PyO3 descriptor group parity from Python public API disposition parity, and require tests for both.
- Add a small exemplar category, such as filters or objects, showing the desired before/after contract from engine descriptor through facade method, binding serde, kernel command metadata, and public readback test.
