Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan that correctly identifies the central architectural problem: the TypeScript bridge advertises and calls stale full-parse surfaces while the current generated/Rust command surface exposes `xlsx_parse_lazy`, `xlsx_parse_lazy_with_mode`, and `xlsx_version`, and production workbook hydration already belongs to the compute import path. The plan fits Mog's contract-first direction well because it treats generated bridge commands, package exports, worker protocol, option mapping, and verification gates as explicit contracts rather than implementation details.

It falls short of a 9 or 10 because the desired product contract is still forked between "lazy metadata worker" and "full import worker", and the plan does not force that decision early enough with a precise API/result contract. It also misses some adjacent stale `xlsx_parse_full` references outside the folder that could keep command-surface drift alive if the implementation claims to solve that category broadly.

Major strengths

- Correctly anchors the work to the production command surface and notes that `parse_full` was removed from `xlsx-api`, while `parse-worker.ts` still calls `xlsx_parse_full`.
- Preserves the right ownership boundary: spreadsheet full import remains `computeBridge.importFromXlsxBytesDeferred` / `compute_import_from_xlsx_bytes_deferred` unless a real Rust/compute command is added.
- Calls out the package export mismatch: `worker/index.ts` documents `@mog/xlsx-parser/worker`, but `package.json` currently exports only `./worker/types`.
- Treats generated bridge types as the source of truth and explicitly rejects local TypeScript mirrors of Rust output as production contracts.
- Covers important worker lifecycle risks: import-time side effects, pending request cleanup, cancellation semantics, transfer ownership, ready failure, terminate behavior, and request-id correlation.
- Verification coverage is meaningfully tied to behavior: package-local tests, export-map tests, fake Worker protocol tests, real browser/Vite smoke, and Rust gates only when Rust command surfaces change.

Major gaps or risks

- The plan should make the lazy-only versus full-import decision its first mandatory milestone. Many later steps depend on that choice, but the current sequencing allows two materially different APIs to coexist as alternatives for too long.
- It mentions adding `BridgeLazyParseResult` aliases through generation if missing, but the current generated `xlsx-types.ts` still contains `FullParseResult` while not exposing obvious lazy result aliases. The plan should name the exact generated file/module that must own these command result types after regeneration.
- Downstream migration is under-specified. The plan says stale full-parse exports may expose compiling consumers, but it does not require an `rg`-backed consumer matrix for `FullParseResult`, `createWorkerParser`, `@mog/xlsx-parser/worker`, and `xlsx_parse_full`.
- Some stale full-parse references outside this folder, such as Tauri platform/security wrapper comments and allowlist entries, are not included. They may be out of scope for this folder, but they are relevant if the plan claims command-name drift should fail verification across descriptors, metadata, declarations, and clients.
- Test setup is not fully specified for this package. `@mog/xlsx-parser` currently has no package-local test script in `package.json`, so the plan should say whether to add Vitest here, reuse a workspace test harness, and what fixture strategy should prove valid XLSX behavior without depending on tooling-only tests.
- The plan is comprehensive but somewhat broad. The edge-case matrix for full import/hydration is appropriate only if the implementation touches full import; the lazy bridge path needs a smaller, exact acceptance matrix focused on lazy result shapes, unsupported options, worker protocol, and export resolution.

Contract and verification assessment

The contract assessment is the best part of the plan. It identifies package privacy, public-repo-only dependency direction, generated command names, production import ownership, option honesty, cancellation limits for synchronous WASM, and environment/bundling constraints. Those are the right contracts for this bridge.

The verification gates are mostly appropriate. TypeScript cleanup should run the package typecheck, tooling typecheck for known imports, package-local tests, and a browser worker smoke for the documented worker entrypoint. Rust tests and clippy are correctly conditional on adding or changing Rust command surfaces. The missing piece is a concrete command-drift gate that fails on stale `xlsx_parse_full` references in callable/security/transport surfaces, plus explicit package test-script setup.

Concrete changes that would raise the rating

- Start the implementation plan with a required decision record: lazy metadata bridge now, or full import via a new generated Rust/compute command. Include final public API names, request/response types, and export subpaths for the chosen path.
- Add an `rg`-based downstream consumer audit as a required step, including `FullParseResult`, `WorkerParseOptions`, `createWorkerParser`, `@mog/xlsx-parser/worker`, and `xlsx_parse_full`, with a migration action for each real consumer.
- Specify the exact generation owner for lazy result TypeScript types and add an assertion that command result aliases correspond to actual generated commands, not merely generated parser-internal structs.
- Add package-local test infrastructure details: test runner, script names, fixture source, fake Worker harness shape, and the exact export-map imports that must pass.
- Include adjacent stale command-surface cleanup or a clearly bounded non-goal for Tauri/security wrapper references so the plan does not leave misleading `xlsx_parse_full` documentation or allowlist entries in production-adjacent code.
- Split the verification matrix into two explicit tracks: lazy-only bridge cleanup and full-import command work, with no full-import gates required for the lazy-only path.
