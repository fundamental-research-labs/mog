Rating: 9/10

# Review — Plan 100: Harden the consumer-boundary harness in `mog/fixtures/external`

## Summary judgment

This is an unusually strong plan. It correctly identifies that the folder's purpose — being the *last* line of defense against public-API leakage — is silently defeated by a small set of "pass-on-any-failure" bugs, and it targets those bugs first. I verified every load-bearing claim against the live source and they hold:

- `assertTypecheckFails` and `assertImportFails` (`shared/utils.mjs:315`, `:337`) both `catch (_e) { return true }` — a negative fixture "passes" on *any* non-zero `tsc`/`node` exit, including a missing tsconfig, missing `typescript`, or a failed `npm install`. Objective 1 is real and is the highest-value finding in the entire plan-rating set I can imagine for this folder.
- `negative/host-bindings-from-kernel-source/smoke.ts` begins with `// @ts-nocheck` and ships a bare `package.json` (no `typescript`, no `tsconfig.json`). Confirmed zero real coverage (objective 2). The plan's sweep instinct is also vindicated: `negative/kernel-host-internal-import/smoke.ts` *also* carries `@ts-nocheck`, so the "audit the whole negative set" step in Phase 2 is not hypothetical.
- Both JSONC readers strip comments with `/\/\/.*$/gm` (`orchestrate.mjs:66`, `contracts-runtime-inventory.mjs:72`) — the string-corruption risk is real (objective 5).
- `requiredNonStubPositiveFixtures` is hardcoded to exactly `kernel` + `sheet-view` (`orchestrate.mjs:382`), and the stub detector is a literal string match on `SKIP:` / `facade package not yet created` / `TODO: Uncomment` (`:400`–`:403`) — objective 4 is accurate.
- `isRetainedRuntimeEntry` OR's in `text.includes('value')` (`contracts-runtime-inventory.mjs:168`) and `BASELINE_RUNTIME_VALUES` is a silent fallback (`:21`, `:31`) — objective 6 is accurate.
- `packPackage` is genuinely imported by `tools/verify-sdk-publish.mjs:36` and used at `:134`/`:137`, so the "preserve this contract" invariant is correctly load-bearing.

The plan is evidence-grounded, correctly scoped to a public source path with internal rationale kept in mog-internal, sequenced sensibly, and pairs each objective with a concrete invariant and an adversarial verification gate. It earns a high rating.

## Major strengths

- **Attacks the right problem first.** Phase 1 (specific-failure assertions) is correctly identified as highest value, because it converts the harness from theater into a real gate. Everything else is secondary hardening.
- **Adversarial / mutation verification gates.** The "Tests and verification" section is the best part: temporarily injecting a syntax error into a negative fixture and requiring the gate to *fail*, adding `@ts-nocheck` and requiring rejection, widening a real `exports` map and requiring the matching negative to flip, deleting the runtime inventory and requiring `contracts-runtime-values` to fail. These prove the strengthened negatives actually bite — exactly the check most plans omit. This is the difference between "we added asserts" and "we proved the asserts catch regressions."
- **Preserve/strengthen split is explicit and accurate.** The manifest invariants, `packPackage` signature, host-native platform filtering, and topological pack ordering are all called out as must-preserve, with the right reasons.
- **Modularize-then-unit-test (Phase 6)** correctly notes the security-critical pure validators currently only run end-to-end through a multi-minute build, and proposes table-driven millisecond tests. Good instinct, and it keeps `packPackage` stable.
- **Non-goals are disciplined.** Explicitly refusing to convert npm→pnpm (npm install reproduces real consumer resolution and must stay) and refusing to change what is/isn't public shows the author understands the harness's reason for existing.

## Major gaps or risks

- **Hermeticity vs. fidelity tension is under-resolved (Phase 3).** The whole point of this harness is to reproduce what a *real external consumer* experiences via plain `npm install`. The plan offers two options — per-fixture committed lockfiles installed `--offline`, or a single shared pinned toolchain symlinked/copied into each temp dir — but does not commit to one, and does not address that the "single shared toolchain" path can alter npm's resolution semantics and weaken the very fidelity the gate exists to provide. This is the weakest phase. The plan should pick the lockfile-per-fixture approach (it preserves real resolution) or explicitly justify the shared-toolchain trade-off. Note also: the toolchain (`typescript`, `esbuild`, `@types/node`) is the fixtures' dev dependency, *not* the packed public surface — pinning it is safe, but the plan should make clear this does not touch what consumers resolve for the packages under test.
- **Coverage-derivation mapping is hand-waved (Phase 4).** "map each inventory entry to its expected positive fixture(s)" needs a concrete convention (naming rule? explicit mapping table in the inventory?). Without it, the derivation can't know that `@mog-sdk/kernel` → `positive/kernel`. Same for "each package with subpath exports has a negative deep-import fixture targeting a non-exported sibling" — *which* sibling, and how is it chosen deterministically? This is specifiable and should be.
- **Two open format decisions left dangling.** `expected-failure.json` vs. an `// @boundary-expect` annotation (Phase 1), and the coverage mapping above. A plan this strong should pick one and state why; leaving both open pushes a design decision onto the implementer that affects every negative fixture.
- **Minor evidence errors.** The plan states `orchestrate.mjs` is 858 lines (actual 857) and that there are 19 negative fixtures (actual 18). Trivial, but a plan that leans this hard on precise evidence should get counts right; the 18-vs-19 slip suggests the negative set wasn't enumerated exactly.
- **Phase 6 refactor risk.** Extracting ~8 pure functions out of an 857-line script that is wired into three publish-readiness gates is the riskiest mechanical change. The plan keeps `packPackage` stable but doesn't call out that the *gate's own* behavior must be byte-for-byte preserved through the extraction (no accidental change to ordering, exit codes, or report text the publish scripts may parse). A "gate output unchanged before/after extraction" check would de-risk it.

## Contract and verification assessment

Contract clarity is high. The two public entry points and their flags (`--manifest-only`/`--skip-build`/`--skip-pack`), the `packPackage` return contract, the manifest invariants, and the platform-native split are all named with file-level evidence and marked preserve-vs-strengthen. The strengthened invariants are stated as testable predicates ("negative passes only when `tsc` fails with a diagnostic attributable to the forbidden specifier"), and the plan wisely hedges the diagnostic matcher on specifier + a small allowed code set rather than exact message text, with TS pinning as the mitigation for cross-version code drift — a real risk it anticipates correctly.

Verification gates are the plan's standout dimension: existing gate stays green, new fast unit tests, four named mutation tests, a coverage self-check (stub fixture for a fake package must fail the gate), a hermeticity check (network-disabled identical result), and confirmation that `verify-sdk-publish.mjs` still consumes `packPackage`. This is comprehensive and adversarial. The only gap is that the gates don't include a "gate output/exit-code parity across the Phase 6 refactor" check, which the publish-readiness wiring would benefit from.

## Concrete changes that would raise the rating

1. **Commit to lockfile-per-fixture for Phase 3** (or explicitly justify the shared-toolchain alternative against the resolution-fidelity it sacrifices), and state that pinning touches only fixture devDeps, never the packed surface under test.
2. **Specify the inventory→fixture mapping** for Phase 4 concretely: a naming convention or an explicit per-package mapping field, plus a deterministic rule for which non-exported sibling subpath each negative deep-import fixture targets.
3. **Pick one expectation format** (`expected-failure.json` recommended — machine-readable, greppable, no parsing of source comments) and drop the alternative.
4. **Add a Phase 6 parity gate:** capture `orchestrate.mjs` stdout/exit code on a known-good run before extraction and assert it is unchanged after, since publish-readiness scripts depend on its behavior.
5. **Fix the evidence counts** (857 lines, 18 negative fixtures) and note that the `@ts-nocheck` sweep must also cover `negative/kernel-host-internal-import`, not only `host-bindings-from-kernel-source`.
