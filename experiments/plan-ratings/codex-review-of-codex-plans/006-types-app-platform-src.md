Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It correctly recognizes that `types/app-platform/src` cannot be improved in isolation because the shell production path currently executes against a local mirror, and it proposes a canonical-contract migration with validators, tests, and boundary checks. It earns a high rating because it preserves the package boundary, targets the actual registry/resolver/activation paths, and treats drift systematically. It is not a 9 or 10 because it leaves the decisive contract matrix, diagnostic taxonomy, exact validator/test architecture, and shell dependency/project-reference mechanics as implementation-time decisions.

Major strengths

- Correct source-of-truth objective: replacing the `shell/src/platform/types.ts` mirror after freezing field names prevents parallel contracts from surviving the work.
- Accurately identifies existing drift: branded constructors are casts, the package validator is shallow, the package has no test script, the package is private/internal, and shell platform code imports from `./types`.
- Good contract shape priorities: discriminated capability subjects, contribution unions, app-facing versus host-internal resource records, plugin isolation denial, and deterministic validation/resolution.
- Production-path focus is clear: package registry, app launch, host context, contribution resolver, trust/isolation, and plugin activation are all named.
- Verification gates are broad and include package-local tests, shell platform tests, shell typecheck, repo typecheck, and boundary/publish-readiness checks.
- Sequencing and parallelization are sensible: freeze the matrix first, migrate shell after canonical decisions, and update docs/boundary inventory last.

Major gaps or risks

- The plan asks implementers to "decide each divergent field once" but does not include the actual matrix or chosen canonical names. The largest correctness risk remains in the handoff, especially for plugin `id` versus `pluginId`, `isolation` versus `isolationMode`, contribution `targetPointId` versus `targetContributionPointId`, service method names, and timestamp formats.
- Diagnostic contracts are under-specified. The plan requires stable codes and JSON-path-like locations, but does not define code naming, path syntax, severity semantics, warning versus error policy, or compatibility/versioning rules.
- Shell dependency mechanics are implicit. The migration likely needs `@mog-sdk/types-app-platform` in `@mog/shell` dependencies and a `shell/tsconfig.json` project reference to `../types/app-platform`; the plan says to import from the canonical package but does not call out those metadata changes or their verification.
- Package-local test architecture is vague. `types/app-platform` currently only has `typecheck`, and `tsconfig.json` excludes tests; the plan should name the runner/setup and how fixtures/tests avoid leaking into `dist`.
- It does not require a negative conformance test that fails if shell platform code reintroduces local mirrors or duplicated literal arrays. That would directly guard the drift the plan is designed to eliminate.
- Plugin validation needs a sharper production-path contract. `plugin-registry.ts` is currently empty while `PluginActivationManager.registerPlugin` accepts shell-local manifests directly; the plan should state exactly where canonical `validatePluginManifest` runs before registration/activation.
- It could specify contract snapshot/declaration identity checks for the generated package surface, not only typecheck. `pnpm --filter @mog-sdk/types-app-platform typecheck` may emit declarations, but it does not by itself prove declarations match the intended subpath contract.

Contract and verification assessment

The contract goals are architecturally sound and match the package boundary: dependency-free, pure validators/helpers, no React/shell/kernel/runtime imports, private workspace-internal status, and serializable shapes for same-realm, iframe, worker, server, and remote bridge modes. The plan is also correct to treat shell conformance as mandatory because the production registry, contribution resolver, host services, trust integration, isolation enforcer, and activation manager currently use `shell/src/platform/types.ts`.

The verification suite is directionally strong, but it should be made more mechanically precise. Add the exact package test script/runner, a shell project-reference/dependency check, a guard that no `shell/src/platform` production file imports mirrored contract types except a re-export shim, and declaration/export assertions for every package subpath. The listed gates are appropriate once those mechanics exist.

Concrete changes that would raise the rating

- Include the actual canonical contract matrix in the plan, with final chosen field names, enum literals, timestamp representation, validation result shape, and shell migration target for each divergent type.
- Add a diagnostic code/path spec before implementation: code catalog, path grammar, severity rules, deterministic ordering, and compatibility policy.
- Explicitly require `@mog/shell` dependency and TypeScript project-reference updates for `@mog-sdk/types-app-platform`, plus a verification step that project references build in dependency order.
- Specify the package test runner and scripts, and require tests for generated declarations/subpath exports alongside validator behavior.
- Add anti-drift conformance checks that fail on shell-local contract literals/mirrors after migration.
- State the exact plugin manifest acceptance path: canonical validation at `registerPlugin` and/or package discovery before trust, isolation, contribution registration, and activation.
