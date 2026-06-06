Rating: 8/10

Summary judgment

This is a strong, production-aware plan for `mog/infra/transport/src`. It correctly identifies the transport layer as the cross-host bridge boundary, focuses on real production risks rather than cosmetic cleanup, and preserves the central `BridgeTransport.call(command, args)` contract. The best parts are the push toward generated metadata as the authority for NAPI serde behavior, explicit parameter-order verification, browser bundle purity, and host-parity for time injection.

The rating is not higher because the plan is not fully implementation-ready. Several objectives require changes outside the reviewed folder, especially bridge-ts metadata generation and Rust annotations, but the exact generator contract is not specified. The plan also contradicts itself by saying generated files and tests are "not edited by this plan" while later requiring new/updated tests and committed regenerated `command-metadata.gen.ts`. Those contradictions would create avoidable ambiguity for parallel implementers.

Major strengths

- The plan is anchored in the actual production path: `factory.ts`, `factory.browser.ts`, `napi-transport.ts`, `wasm-transport.ts`, `time-injection.ts`, `case-normalize.ts`, `bytes-tuple.ts`, and `bridge-error.ts`.
- It targets real correctness hazards: silent NAPI serde mis-encoding, positional argument order drift, stale error-kind mirrors, and timezone-dependent NOW()/TODAY() behavior.
- It preserves the most important architecture boundaries: public `BridgeTransport` shape, NAPI `docId` stripping versus Tauri passthrough, WASM trap classification, WASM reset semantics, bytes-tuple formats, and browser entrypoint purity.
- It recognizes generated metadata as the right source of truth and avoids proposing more hand-maintained maps in transport code.
- The sequencing is mostly sensible: serde/codegen first, factory and timezone in parallel, arg-order and error-kind contracts with codegen, case-normalization optimization only after measurement.
- The verification section is much better than a compile-only gate. It names package tests, typecheck, build, codegen regeneration, bundle-purity checks, and representative behavior tests.

Major gaps or risks

- The edit scope is internally inconsistent. The opening says `command-metadata.gen.ts`, all `__tests__`, package config, and codegen are not edited, but the concrete plan requires adding tests, extending tests, changing bridge-ts/codegen, and committing regenerated metadata. The plan should distinguish "do not hand-edit generated artifacts" from "regenerate and commit generated artifacts".
- The serde codegen fix is underspecified. Current bridge-ts metadata infers NAPI JSON needs from `TsType`, which is exactly why primitive `[serde]` values are missed. The plan says to add annotations or metadata hints, but it does not define the new parsed model field, Rust annotation source, emitted TS schema, or conflict rules.
- The dev/test versus production fallback behavior is not specified enough. Throwing in development/test and warning in production needs a concrete environment discriminator that works in both browser and Node ESM bundles without pulling Node globals into browser code.
- The arg-order guard is conceptually right but incomplete. The plan should define whether the generated param order includes `docId`, how NAPI strips it, how Tauri/WASM compare the full list, and how optional/rest-like parameters are represented.
- Factory dedup has a browser import-graph risk. The plan says the WASM helper is browser-safe and NAPI stays behind Node-only boundaries, but it should prescribe separate modules, for example a browser-safe `compose-wasm.ts` and a Node-only `compose-napi.ts`, rather than leaving co-location in `factory.ts` as an option.
- The proposed "structurally identical stack" factory test is vague. The existing wrappers do not expose stack identity, so the plan needs a test seam or a dependency-injection strategy that proves middleware order without brittle implementation introspection.
- Phase C changes an exported function signature, `createHeadlessNapiTransport`. Even with a default argument, this is public API surface through `index.ts`; the plan should call out docs/API snapshot or publish-readiness checks if this package participates in generated API baselines.
- Phase F remains too qualitative. "Drive Rust-side rename_all coverage high enough" needs a measurable acceptance criterion, a named hot-response set, and ownership for the Rust structs that still emit snake_case.

Contract and verification assessment

The contract analysis is the strongest part of the plan. It correctly treats serde encoding, arg order, lifecycle interception, trap classification, time serial space, bytes-tuple unpacking, and bridge-error sentinel parsing as transport contracts rather than local implementation details. The browser bundle constraint is also explicitly preserved, which is essential for this package.

The verification gates are good for TypeScript transport work but incomplete for the Rust/codegen work the plan depends on. If bridge-ts or Rust annotations change, the implementing PR should include explicit Rust gates such as the relevant `cargo test -p bridge-ts ...` generator tests, the up-to-date verification path for `command-metadata.gen.ts`, `cargo test -p value-types --lib errors` for error-kind shape, and clippy for any changed Rust crate. The plan mentions `pnpm generate:bridge`, but generation alone is not the same as a stale-output CI gate.

The planned tests also need sharper acceptance criteria. Serde coverage should assert every command has authoritative metadata or an intentional explicit exclusion. Error-kind coverage should compare a generated `BRIDGE_ERROR_KINDS` value against the TypeScript union, not just hand-enumerated examples. Bundle purity should be an automated assertion over the built browser artifact, not a manual inspection.

Concrete changes that would raise the rating

1. Resolve the scope contradiction up front: say implementation will edit transport source/tests plus bridge-ts/Rust metadata sources as needed, and generated files will be regenerated, not hand-edited.
2. Specify the new metadata schema exactly, including `NAPI_SERDE_PARAM_INDICES`, ordered parameter names, bridge error kinds, `docId` handling, and whether these live in one generated object or separate exports.
3. Name the bridge-ts parser/emitter files and Rust annotation sources that must change for primitive `[serde]` parameters, and define how conflicts between old hand-map entries and generated metadata are resolved.
4. Define the dev/test/prod gating mechanism for missing metadata and arg-order assertions, including browser-safe behavior and one-time diagnostic semantics.
5. Make the factory refactor import graph explicit: browser-safe composition in a module with no Node/NAPI imports, Node-only NAPI composition in a separate module, and tests that prove `index.browser.ts` cannot pull `napi-loader`.
6. Add exact Rust and generated-artifact verification gates alongside the existing `pnpm --filter @mog/transport` gates.
7. Turn Phase F into a measurable follow-up: list the hot commands, baseline payload sizes/cost, target allocation behavior, and the specific Rust output types that must already be camelCase before reducing walker allocation.
