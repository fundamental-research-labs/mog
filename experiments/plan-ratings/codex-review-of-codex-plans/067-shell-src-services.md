Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan for `shell/src/services`. It correctly identifies the service layer as the shell control plane, names the important ownership boundaries, and anchors the highest-priority work in real current risks: raw path-prefix checks in `ProjectService`, an overlarge `createDocumentManager`, partial transactional semantics in project operations, and a shell facade that still needs sharper public-contract tests. The plan is unusually complete on invariants and verification breadth.

The rating is not higher because several major proposed abstractions are still underspecified as contracts. The plan says to add a path authority, operation coordinator, broader service error taxonomy, durable capability authority, and expanded `ShellService`, but it often stops before defining the exact API shapes, failure-state transitions, persistence semantics, and migration inventory needed for parallel implementation to compose without interpretation.

Major strengths

- The plan is grounded in the actual source. Current `ProjectService` does use lowercased string normalization and `startsWith` for boundary checks, open-file dedupe is raw `filePath === filePath`, and delete uses `filePath?.startsWith(path + '/')`; the path-authority priority is justified.
- It preserves correct existing ownership: `DocumentManager` owns handles/resources/modes, `ProjectService` owns project/open-file store state, `ShellService` remains a facade, recent docs stay Meta-backed, and trap recovery coordinates through `DocumentManager`.
- The lifecycle invariants are concrete and useful. The document-manager section calls out generation aborts, dispose/open races, collaboration close retention, path-source rejection, XLSX/CSV identity binding, and imported pivot metadata best-effort behavior.
- Verification expectations are broad and mostly production-relevant: focused unit gates, shell typecheck, public type-package gates when `types/document` changes, Rust/Tauri gates for native path commands, and UI-driven E2E for file workflows.
- The parallelization notes are realistic. The proposed slices map to separable packages and dependency boundaries instead of treating the whole services folder as one monolith.

Major gaps or risks

- The path-authority contract is directionally right but not exact enough. `ProjectCanonicalPath` is not specified as a branded string versus a structured `{ raw, canonical, display, platform }` value; the plan does not define whether identity uses resolved symlinks, whether display paths preserve case, how case-sensitivity is surfaced, or the precise Rust/Tauri command signatures and error codes.
- Transactional project operations need a formal state machine. The plan names staging and rollback patterns, but does not define commit records, rollback ownership after partial native side effects, operation IDs, interleaving rules across open/save/rename/delete, or what the store exposes while an operation is pending.
- The service error taxonomy risks becoming a large refactor without a migration contract. It should say which errors replace existing `ProjectError`, how raw `Error` from `DocumentManager` is adapted, where user-safe messages are produced, and which callers must exhaustively switch on each discriminant.
- The `ShellService` section needs an inventory of actual remaining reach-arounds. Current action handlers already use `deps.shellService`; direct `DocumentManager` use remains in places like boot/index and collaboration UI. The plan should separate action-handler contract gaps from app/root/collab service consumers.
- Capability persistence is a substantial new product/security contract. The plan proposes persistence, rehydration, policy modes, and audit durability, but does not specify the host storage interface, consistency model, encryption/security expectations, versioning, or what happens when persisted grants reference capabilities removed by a newer runtime.
- The plan is very broad. It has good slices, but no dependency-ordered first deliverable beyond "path authority highest priority." Without sharper acceptance criteria per slice, implementers could spend effort on modularization or diagnostics before eliminating the concrete path/data-loss risks.

Contract and verification assessment

Contract quality is high for preserving existing behavior and medium for new APIs. The invariant lists are strong enough to prevent many regressions in document lifecycle, recency, trap recovery, and ownership. The weakest contracts are the new ones: path authority, project transaction coordinator, common diagnostics, and durable capability storage need exact types, call sites, and failure semantics before implementation.

Verification quality is high. The plan names the relevant service tests, shell-wide tests, `pnpm typecheck`, public type gates, Rust/Tauri gates where native commands change, and UI workflows through real input paths. The main missing verification detail is acceptance testing for new path authority behavior against real desktop filesystem cases, especially symlink resolution, case-sensitive volumes, UNC paths, and Tauri command security registration.

Concrete changes that would raise the rating

- Define `ProjectPathAuthority` precisely: value types, sync/async methods, native command names, error discriminants, symlink/case policy, display-vs-identity rules, and mock modes that must match production semantics.
- Add a dependency-ordered implementation sequence with explicit acceptance criteria for each slice, starting with path boundary safety and transactional project operations before lower-risk modularization.
- Specify the project operation state machine: pending/committed/failed states, rollback rules after each side effect, concurrency keys, and how UI callers observe recoverable errors.
- Inventory current consumers of `DocumentManager`, `ProjectService`, `ShellService`, and `window.__SHELL__`-style paths, then state which consumers move and which intentionally stay direct service consumers.
- Turn the service error taxonomy into concrete discriminated unions and adapter points, with a migration rule for existing `ProjectServiceError` tests and raw document/trap errors.
- Add real desktop path verification requirements, not only mock tests, for `/project` versus `/project2`, symlink escape, case-sensitive/case-insensitive volumes, Windows drive/UNC handling, and generated Tauri command registration.
