Rating: 8/10

Summary judgment

This is a strong plan with real production-path relevance. It correctly identifies the high-leverage problems in `mog/types/app-platform/src`: unchecked nominal constructors, shallow app manifest validation, no plugin manifest validator, loose cross-module strings, and the divergent shell mirror that prevents the package from becoming the single source of truth. The phased structure is mostly sound, and the plan respects the package's core architectural constraints: dependency-free, contracts-only, immutable fields, precise subpath exports, and type/value export separation.

The rating is not higher because several contract details are still too underspecified for a "verifiable contracts" workstream, and the plan has a scope contradiction around `package.json` exports. New validator subpaths and production adoption cannot work without export-map changes, but the source-folder scope initially marks `package.json` out of scope. The test plan also assumes a unit test path without naming or adding an executable test runner, while `tsconfig.json` currently excludes tests and the package only has a `typecheck` script.

Major strengths

- The source inventory and current-state diagnosis are accurate. The existing app validator only checks top-level fields and duplicate route/contribution IDs, branded constructors are unchecked casts, and plugin validation is absent.
- The plan targets the canonical contract layer rather than shell-only compatibility code, so the work is production-relevant and aligned with the dependency direction.
- It preserves important package invariants: zero runtime dependencies, no React/shell/kernel imports, nominal `unique symbol` brands, `readonly` contract fields, and type-only barrel exports.
- It separates additive work from breaking type alignment and calls out the need to coordinate the latter with the shell platform plan.
- The plan recognizes security-relevant trust/isolation boundaries for plugin manifests and treats plugin validation as a first-class contract instead of an app-manifest clone.
- Verification coverage is directionally good: package typecheck, unit tests, dependency audit, subpath resolution, downstream shell typecheck, and contract graph inventory.

Major gaps or risks

- The folder boundary is not fully coherent. The plan says `package.json` exports are out of scope, but Phase 4 and Phase 7 require new `./plugin/validation` and shared validation/core subpaths. That has to be either in scope for the implementation or explicitly assigned to a coupled package-root follow-up that lands with the source change.
- Several validation contracts are named but not specified. `CAPABILITY_ID_RE`, `ROUTE_PATH_RE`, semver range validation for `versionRange`, activation-event selector rules, warning versus error boundaries, and exact diagnostic `code`/`path` matrices need concrete definitions before implementation.
- The "drift guard" is described too loosely. A `readonly (keyof AppManifest)[]` does not by itself force total coverage of required keys; the plan needs a specific type-level assertion pattern or generated/runtime comparison that actually fails when a required field is omitted.
- The test plan is not executable as written. The package has no test script, and `tsconfig.json` excludes `src/**/__tests__/**` and `*.test.ts`. The plan should say whether to add a package test script/config, use an existing workspace runner, or create compile-only contract fixtures.
- Phase 6 changes service and trust method signatures but does not define the full migration contract for existing host implementations. Returning `CapabilityGrant`, `GrantResult`, and `PlatformError` are all plausible, but the plan should choose exact shapes and acceptance criteria.
- Required `manifestSchemaVersion` is a breaking contract change. It may be right for a private `0.1.0` package, but the plan should enumerate every canonical fixture/downstream manifest that must be updated or explicitly state that no current consumer imports this package directly.

Contract and verification assessment

The plan has the right architectural fit for a contracts package, but the central contract tables need to be more precise. For both app and plugin validation, the implementer should have an explicit field-by-field matrix: requiredness, accepted type, accepted enum/format, duplicate/coherence checks, diagnostic code, diagnostic path, and severity. The same applies to parsed brand constructors: exact regex, accepted examples, rejected examples, and the documented relationship between unchecked `createX` and checked `parseX`.

Verification is broad enough in intent but incomplete in mechanics. `pnpm --filter @mog-sdk/types-app-platform typecheck` is the right base gate. The plan also needs a concrete unit-test command, a type-negative fixture strategy for brand strength, an export-map/subpath resolution check after adding new subpaths, and a zero-dependency/no-outside-import audit. Downstream shell verification is appropriate for Phases 5-6, but those phases should not be treated as independently complete unless the shell mirror migration or compile breakage is handled in the coordinated shell workstream.

Concrete changes that would raise the rating

1. Resolve the scope contradiction by making `package.json` export-map edits explicitly in scope for this package change, or by defining a same-PR/package-root companion task that must land before new subpaths are considered complete.
2. Add concrete validation matrices for `AppManifest` and `PluginManifest`, including exact diagnostic codes, JSON paths, severity, and examples for every new regex/enum/selector rule.
3. Specify the actual test runner and commands to add or use for `src/**/__tests__/**`, plus the compile-fixture mechanism for `@ts-expect-error` brand tests.
4. Replace the vague drift guard with a mechanically sound type assertion, such as a required-key equality check between `AppManifest` and `REQUIRED_MANIFEST_FIELDS`, backed by a runtime fixture for validator coverage.
5. Split the implementation acceptance gates into additive Phases 1-4 and coordinated breaking Phases 5-6, with an explicit "do not land alone" rule for breaking shell-facing signature changes.
6. Choose the shared module layout up front, preferably a leaf `core` or `validation` module for formats, `ParseResult`, diagnostics, and contract versioning, so cross-module imports do not create cycles.
7. Define the exact `PlatformError`, capability request/grant result, and discriminated `CapabilitySubject` shapes before implementation rather than leaving multiple acceptable alternatives.
