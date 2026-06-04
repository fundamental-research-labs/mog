Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan for `runtime/spreadsheet-app/src`. It accurately identifies the package as the public full-app embed facade and focuses on the real risk areas visible in the source: the large `runtime.ts` controller, manual dirty-event classification, capability facade coverage, private-type boundary checks, runtime-owned attachment semantics, and package test scripts that currently do not run the existing `src/__tests__` node tests. The plan is broad but mostly coherent, with clear invariants and a good parallelization model.

The rating is not higher because several workstreams still need sharper acceptance criteria before they are implementation-ready. In particular, the proposed contract inventory, generated dirty-event metadata, browser/React test harness, public guide updates, and cross-package event taxonomy changes are named but not pinned to exact files, generated artifacts, commands, or ownership boundaries.

Major strengths

- The scope is correctly centered on the shipped public runtime package, not test-only helpers or a mock embed path.
- The plan preserves key public invariants: exact package exports, no private type leakage in declarations, same-origin trusted embed semantics, runtime-owned workbook sessions, detach without disposal, single UI attachment, epoch invalidation, and strict save acknowledgement matching.
- It calls out real current-state gaps. `runtime.ts` mixes session lifecycle, attachment, save state, authorization, event dispatch, and disposal logic; `dirty-events.ts` is a manually maintained event-name set; `getEffectivePolicySnapshot()` currently omits `workbook:policy-admin`; `actorEditLevel()` exists but policy enforcement is not fully centralized; and the package `test` script only runs the matrix generator plus boundary check rather than the TS node tests under `src/__tests__`.
- Verification is mostly aligned with the production path: package test/typecheck/build, publish-readiness, declaration/API snapshot checks, built `dist` boundary checks, real React mounting, and E2E interaction through keyboard/mouse/clipboard.
- The parallelization notes are useful because they split along real module boundaries: public API/declarations, runtime lifecycle/save state, facade/policy, attachment UI, dirty classification, and verification integration.

Major gaps or risks

- The plan is very large and could become a long-running refactor unless it defines a commit or milestone sequence with behavior-preserving gates at each step. It says to land transition modules with golden tests first, but does not turn that into an ordered acceptance checklist.
- The contract inventory is under-specified. It should name the exact artifact shape and path, for example a generated JSON or TS fixture, the snapshot update command, and the command that fails when public exports, stylesheet entrypoints, capability names, slot names, or lifecycle states drift.
- The dirty-event registry work crosses `contracts`, `types/events`, and this package. The plan correctly says metadata should live in the shared taxonomy, but it does not define the metadata schema, whether read/lifecycle/ignored classifications are part of the public contract, or how generated output avoids a dependency cycle.
- The browser/React verification asks for real mounting and E2E coverage, but this package currently has no obvious local browser test harness. The plan should specify whether tests live in `runtime/spreadsheet-app`, `apps/spreadsheet`, or internal app-eval, and what command becomes the package-local gate.
- The facade matrix generator is already generated from `runtime/sdk/src/generated/api-spec.json`; the plan asks for richer entries but does not define how to classify ambiguous method names, property getters, resource contexts, or deny reasons without relying on brittle naming heuristics.
- Public docs/examples are included only at the end. The plan should name the guide paths and state which docs changes are allowed in the public repo versus internal-only review material.

Contract and verification assessment

The contract posture is above average. The plan lists the right public contracts and protects dependency direction by keeping private shell/app/kernel types out of declarations. It also recognizes that save state must be matched by epoch, dirtyEpoch, changeSequence, saveRequestId, and bytesHash, which is the right level of precision for host-owned persistence.

Verification is also strong in intent, especially the built `dist` boundary checks and real UI input requirement. The main weakness is command specificity. `pnpm --filter @mog-sdk/spreadsheet-app test`, `typecheck`, and `build` are concrete, but the new node, React/browser, E2E, API snapshot, and publish-readiness gates need exact scripts and CI placement so implementers cannot satisfy the plan with ad hoc tests that never run.

Concrete changes that would raise the rating

- Add a milestone sequence with explicit "done" gates for each phase: contract inventory, pure lifecycle/save modules, policy service, facade matrix generation, dirty-event generation, React/browser tests, and final docs.
- Specify exact generated files and commands for the contract inventory, dirty classifier, facade matrix, declaration snapshot, and package test integration.
- Define the shared event metadata schema and ownership path before asking implementers to generate dirty classification from it.
- Name the browser/E2E harness and test locations, including how `MogSpreadsheetApp` and `mountSpreadsheetApp()` are mounted and how real keyboard/mouse/clipboard actions are driven.
- Add facade-matrix acceptance cases for all non-method public properties, symbol members, getters returning child handles, promises, arrays, and resource-specific policy contexts.
- Identify the public docs/example files to update and require that documentation changes land only after the source gates pass.
