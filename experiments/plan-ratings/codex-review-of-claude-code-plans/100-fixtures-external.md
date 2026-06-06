Rating: 7/10

Summary judgment

This is a strong, production-relevant hardening plan for a genuinely important boundary harness. It correctly identifies that the external fixture runner is the gate that proves packed public packages work outside the pnpm workspace, and it focuses on high-value failure modes: negative fixtures passing for the wrong reason, suppressions that defeat the test, non-hermetic npm installs, inventory drift, weak JSONC parsing, and untested manifest validators.

The main reason it is not higher is that the plan's own inventory assertions are not fully aligned with the current tree. It says there are 19 negative fixtures, but the folder currently has 18. It treats the `kernel` positive fixture as a must-run public external fixture, while the current inventory marks `@mog-sdk/kernel` as `workspace-internal` and `private: true`; under the current orchestrator logic, fixtures depending on non-pack-targets are skipped as deferred rather than required. The plan also leaves the hermetic npm/cache design and inventory-derived coverage contract too open for reliable implementation.

Major strengths

- The plan targets the production path: `npm pack`, packed manifest validation, temp-dir `npm install`, TypeScript/runtime smoke checks, and the publish-readiness scripts that call the harness.
- The highest-priority objective is correct. `assertTypecheckFails` and `assertImportFails` currently pass on any failure, so requiring diagnostics tied to the forbidden specifier is the right structural fix.
- It preserves important existing contracts, especially `packPackage(packageDir)` and the `orchestrate.mjs` CLI flags used by publish-readiness checks.
- The proposed adversarial checks are much better than ordinary "run the gate" verification: unrelated syntax error, `@ts-nocheck`, widened exports, missing runtime inventory, and stub coverage mutations would prove the new guardrails actually bite.
- The plan recognizes that manifest validation is security-critical pure logic trapped inside a large script, and extracting it for table-driven tests is architecturally sound.

Major gaps or risks

- The fixture inventory is stale or insufficiently investigated. Current evidence shows 18 negative fixture directories, not 19, and two negative fixtures contain `@ts-nocheck` with bare manifests: `host-bindings-from-kernel-source` and `kernel-host-internal-import`.
- The plan needs to resolve the `@mog-sdk/kernel` mismatch before deriving coverage. If kernel is intentionally private/workspace-internal now, the plan should not classify its positive fixture as a required public consumer fixture unless a separate public-surface change is in scope.
- "Every ship-public and binary-wrapper package has at least one non-stub positive fixture" is too blunt. Platform-native binary wrappers, aggregate fixtures, deferred packages, CSS-only exports, and packages with public subpaths need an explicit package-to-fixture/export-to-fixture coverage schema.
- The hermetic toolchain phase does not choose an implementation. `npm ci --offline` is nontrivial when fixture `package.json` files are rewritten to `file:` tarballs at runtime; the plan should specify lockfile generation, cache location, cache warm-up, cold-cache behavior, and how dynamic local tarballs remain lockfile-consistent.
- The JSONC consolidation is underspecified across module boundaries. Existing helpers in `tools/package-export-dispositions.mjs` and `tools/public-package-manifest.mjs` also use regex comment stripping, so merely importing a current helper would not fix the bug.
- The plan lists several cross-folder files as out of scope, but Phase 5 and Phase 6 may require shared tooling or package-script/test-runner wiring outside `fixtures/external`. That edit boundary should be made explicit.

Contract and verification assessment

The contract direction is good: negative fixtures should pass only for the intended boundary violation, suppressions in negative fixtures should be rejected, packed manifests should preserve public-package invariants, and runtime inventory coverage should fail closed instead of falling back to a baseline. The plan also correctly preserves npm-based external installation rather than replacing it with pnpm workspace behavior.

Verification is mostly strong, especially the mutation tests. The missing pieces are exact expected-failure schema semantics and exact test gates. The plan should define where `expected-failure.json` lives, how multiple forbidden imports are handled, which TypeScript diagnostic codes are allowed, how runtime export errors are matched, and whether unrelated diagnostics fail the fixture or are reported separately. It should also name the concrete unit-test command or harness for extracted validators, because "new unit tests" without runner integration is not a verifiable gate.

Concrete changes that would raise the rating

- Re-run and record the actual fixture inventory in the plan: 9 positive fixtures, 18 negative fixtures, both `@ts-nocheck` negative fixtures, and which fixtures are currently required versus skipped by pack-target classification.
- Add a public-surface decision for `@mog-sdk/kernel`: either make it an explicit required external package in scope, or treat existing kernel fixtures as deferred/private-boundary fixtures with different coverage expectations.
- Define a concrete coverage manifest, for example package name, export subpath, fixture name, assertion kind, required/optional status, and rationale. Generate checks from that manifest plus `package-inventory.jsonc`.
- Choose one hermetic install design and spell out the lock/cache mechanics, including how rewritten `file:` tarball deps interact with `npm ci` and offline mode.
- Specify the exact expected-failure file format and diagnostic matcher behavior before implementation.
- Clarify whether shared JSONC parser and validator unit-test wiring are allowed to touch `tools/` or root package scripts, or split those into explicit follow-up plans.
