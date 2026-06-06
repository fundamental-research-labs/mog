Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for turning `fixtures/external` into a real installed-public-artifact boundary contract. It correctly treats the folder as a production-path consumer gate, not a normal unit fixture folder, and its main diagnoses match the current harness: packed tarballs are installed with npm in temp fixture environments, but negative assertions currently accept any `tsc` or Node import failure, grouped negative smoke files can hide leaks, some fixtures are not normalized external consumers, skipped coverage is not contract-backed, and packed artifact content is not scanned beyond manifest/export-target shape.

The rating is not higher because the plan is broader than its own "first implementation slice" framing. It specifies the right end state, but it needs a tighter manifest schema, sharper generated-case contracts, and staged acceptance criteria so implementers can land the strengthened gate without ambiguous intermediate states.

Major strengths

- The plan is architecturally aligned with Mog's package-boundary model. It anchors coverage in `tools/package-inventory.jsonc`, export dispositions, public package manifests, declaration rollups, API snapshots, and binary-wrapper checks rather than inventing a second source of truth.
- It preserves the important production path: build/pack public packages, validate packed manifests, install tarballs into isolated npm consumers, then typecheck or run fixture code. That is exactly the path this folder should protect.
- The negative-fixture critique is precise. `assertTypecheckFails` and `assertImportFails` currently pass on any failure, which means missing TypeScript, bad setup, unrelated declarations, or the first failed import in a grouped file can create false confidence.
- The plan follows the "complete set" principle well. It expands from individual leaks to package dispositions, all export subpaths, runtime-valued contracts, private friend exports, binary wrappers, browser/bundler surfaces, artifact contents, and skip discipline.
- Verification gates are mostly well chosen. `pnpm check:external-fixtures`, `pnpm check:public-package-manifests`, `pnpm check:publish-readiness:sdk`, and `pnpm validate:all-boundaries` are the right production gates, and the proposed new behavior gates target the known failure modes.
- Sequencing is sensible at a high level: harden negative precision first, add coverage accounting, then layer generated positive coverage, content scanning, friend stripping checks, and browser tiers.

Major gaps or risks

- The implementation surface is very large: coverage manifest, generated positive cases, generated negative cases, scanner, runtime inventory expansion, browser fixtures, binary-wrapper checks, diagnostics, gate wiring, and public README. That is probably the correct end state, but the plan should define smaller enforceable milestones with exact acceptance criteria.
- The proposed `coverage.manifest.jsonc` is underspecified. It needs a concrete schema, row identity rules, computed-versus-hand-authored fields, allowed skip/deferred reason enums, host-platform semantics, fixture ownership fields, and a deterministic freshness/update command.
- Positive export-map coverage needs exact classification rules. The plan names value, type-only, style, wasm, binary, browser, and Node cases, but does not specify the import syntax and assertions for each export condition or how conditional `types`/`import`/`require`/`default` maps are normalized.
- Packed content scanning is directionally right but needs a parsing strategy. A raw text scan risks false positives in comments, source maps, string literals, or generated metadata, while also missing dynamic or declaration-only leaks. The plan should say which file types are parsed structurally and which are scanned textually.
- Negative diagnostic precision can become brittle if expected messages are too exact. The plan recommends diagnostic codes and specifier matching, which is good, but it should define the helper contract around stable TypeScript codes and Node error classifications.
- The rollout story is incomplete. If the coverage manifest immediately fails on every unowned public export, implementers may have no green integration point. The plan should either include enough generated baseline coverage in the same milestone or define a temporary reporting mode with a clear enforcement switch.
- The browser/DOM tier could become expensive or flaky unless the plan distinguishes lightweight bundler resolution from actual DOM execution and names the minimal public behaviors that require browser runtime checks.

Contract and verification assessment

The plan's contract model is strong. It states the core invariants clearly: public tarballs cannot contain workspace specs, forbidden internal package families, development export conditions, unstripped friend exports, missing export targets, or private declarations; positive fixtures must use public specifiers; negative fixtures must fail for the intended boundary reason after successful install; skipped rows must be explicitly approved.

The verification section is relevant and production-path oriented. The biggest missing piece is harness-level regression coverage for the new harness itself: synthetic cases proving unrelated TypeScript errors do not count as negative passes, each forbidden specifier is isolated, missing `tsconfig.json` fails setup validation, scanner fixtures catch forbidden imports in packed `.d.ts` and `.js`, and manifest-approved skips are the only accepted skips.

Concrete changes that would raise the rating

- Add a concrete `coverage.manifest.jsonc` example with representative rows for `@mog-sdk/contracts`, `@mog-sdk/embed`, `@mog-sdk/wasm`, a stripped friend export, an optional native wrapper, and the currently deferred `@mog-sdk/kernel` fixture state.
- Split the plan into 3-5 milestones, each with changed files, pass/fail acceptance criteria, and required gates. The first milestone should be small enough to make false-positive negatives impossible.
- Define the generated case runner API, including exact metadata fields and proposed signatures for `assertTypecheckFails` and `assertImportFails`.
- Specify scanner implementation details: tarball traversal, file-type handling, structured import extraction where available, text-scan fallbacks, allowlist format, and source-map/comment treatment.
- Add explicit fixture harness self-tests or synthetic fixtures for the new precision rules.
- Include an initial coverage matrix snapshot showing active public packages, export subpath counts, current fixture owners, deferred rows, and expected new generated coverage.
- Clarify browser-tier scope so bundler checks stay lightweight and DOM execution is reserved for public APIs whose contract actually includes browser runtime behavior.
