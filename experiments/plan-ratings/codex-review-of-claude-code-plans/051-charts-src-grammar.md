Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan. It correctly identifies `compile()` / `compileLayered()` and the trace builders as the load-bearing surface of `mog/charts/src/grammar`, treats `CompileResult` trace payloads as cross-package contracts, and sequences characterization before refactor work. The rating is not higher because several acceptance details are not executable as written: the plan says Vitest while `@mog/charts` uses Jest, it undercounts existing grammar coverage outside `src/grammar/__tests__`, and it needs sharper contract-test and command-level verification definitions before implementation can proceed safely.

Major strengths

- The scope is well bounded to `charts/src/grammar` and distinguishes internal refactors from public/rendering and kernel-visible behavior.
- The plan accurately recognizes that trace objects are production evidence consumed by `mog/kernel/src/domain/charts/bridge`, not incidental or test-only output.
- Helper consolidation is conservative: it calls out distinct clamp-like helpers that should not be merged blindly, and it preserves NaN/finiteness behavior as a first-order concern.
- The proposed sequencing is mostly correct: characterize trace and axis/area behavior before extracting shared helpers or decomposing large functions.
- The plan includes useful invariants for clipping, default mark/size behavior, skip options, text measurement plumbing, and `CompileResult` field names.

Major gaps or risks

- The test inventory is materially incomplete. There are only four test files directly under `charts/src/grammar`, but there are many existing package-level grammar/core tests under `charts/__tests__/grammar` and `charts/__tests__/core` that already exercise `compile`, transforms, stacking, config-to-spec, stock traces, and surface compilation. The plan should classify those as existing coverage and identify the precise uncovered trace-builder contracts instead of treating the folder as nearly untested.
- The verification framework is wrong as written: `charts/package.json` uses `jest` and `ts-jest`, not Vitest. The plan should name exact commands such as `pnpm --filter @mog/charts test`, targeted Jest invocations where useful, `pnpm --filter @mog/charts typecheck`, and the relevant `@mog-sdk/kernel` chart-bridge tests.
- Public surface handling is slightly ambiguous. Adding `grammar/numeric.ts` should remain an internal import unless the plan intentionally expands the `./grammar` subpath export surface. The current `index.ts` exports many grammar APIs, so the plan should explicitly say whether the new helpers are excluded from `index.ts`.
- The axis decomposition phase is directionally right but too abstract. `computeTicks`, `layoutTickLabels`, and similar names do not define exact inputs/outputs, mark ordering guarantees, or how multi-level labels and crossing math remain byte-equivalent. That is the riskiest implementation phase.
- The trace-contract test is underspecified. Asserting presence of key paths is a useful tripwire, but the kernel consumers depend on value types, status enums, arrays, ordering, and nested diagnostic fields. The field list should be generated or copied from the kernel evidence arrays and paired with representative value assertions.
- Some factual language should be tightened: `normalizePlotX/Y` are semantically duplicated but not literally verbatim, and "byte-for-byte unchanged" is not a realistic acceptance criterion for a TypeScript refactor unless backed by exact serialized output snapshots.

Contract and verification assessment

The contract framing is the plan's best part. It names the correct production boundary (`CompileResult`) and the correct downstream consumer (`mog/kernel/src/domain/charts/bridge`). It also correctly forbids reshaping trace interfaces as part of helper cleanup.

The verification section needs to become command-level and fixture-level. The minimum credible gate should include the charts Jest suite or targeted grammar subset plus `@mog/charts` typecheck, and a kernel bridge gate that proves resolved chart snapshots still consume the same trace paths. The plan should also define fixture names for scatter, line, area, bar/stacked bar, stock, 3D, surface, and layered combo cases, with expected trace-path/value assertions per fixture.

Concrete changes that would raise the rating

- Replace "vitest" with the repository's Jest harness and list exact commands for charts and kernel verification.
- Add an existing-coverage audit table: current tests, what contract each covers, and the remaining uncovered trace-builder gaps.
- Define the trace contract test as a table of kernel-consumed paths, expected value types/status enums, and representative fixtures, not only a presence snapshot.
- Specify that `numeric.ts` is internal-only and must not be exported from `charts/src/grammar/index.ts` unless an API review intentionally approves it.
- Break Phase B into smaller, verifiable extraction contracts for `generateXAxis`, `generateYAxis`, and `collectAreaGeometry`, including mark-order snapshot expectations before and after each extraction.
- Replace arbitrary "no function >~120 lines" with a reviewability target plus behavior gates; line count should not become the definition of correctness.
