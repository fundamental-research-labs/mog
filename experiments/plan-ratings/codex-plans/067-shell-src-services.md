# 067 - Shell Services Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/shell/src/services`

Queue item: 67

Scope: the shell services layer that owns shell-lifetime document handles, project and file lifecycle orchestration, action-handler document facades, shell capability grants and audit logs, recent document recency mirroring, shared lifecycle/devtools state, collaboration room resolution, imported pivot metadata attachment, and wasm trap recovery.

Files and integration points inspected:

- `shell/src/services/shell-service.ts`
- `shell/src/services/active-document-recency.ts`
- `shell/src/services/collab-room.ts`
- `shell/src/services/lifecycle-state.ts`
- `shell/src/services/capabilities/*`
- `shell/src/services/document/*`
- `shell/src/services/project/*`
- `shell/src/services/recent-docs/*`
- `shell/src/services/trap-recovery/*`
- `shell/src/bootstrap/create-shell.ts`
- `shell/src/bootstrap/types.ts`
- `shell/src/context/project-service-context.tsx`
- `shell/src/context/shell-service-context.tsx`
- `shell/src/hooks/use-document.ts`
- `types/document/src/shell/types.ts`
- Existing service tests under `shell/src/services/**`

Scope this plan does not cover:

- Replacing the kernel document model, host adapter runtime, transport layer, or compute engine.
- Moving shell-only service ownership into apps or into React component state.
- Test-only shortcuts for E2E setup.
- Compatibility shims that preserve ambiguous service ownership instead of eliminating it.
- Changing production app workflows without exercising the real UI input paths.

## Current role of this folder in Mog

`shell/src/services` is the shell's operational control plane. It sits above kernel/runtime document creation and below React contexts, hooks, event dispatchers, and app action handlers.

Observed responsibilities:

- `document/create-document-manager.ts` creates the singleton `DocumentManager` for a shell instance. It owns the maps for loaded document handles, loading promises, loading states, errors, generation fences, per-file operation chains, host adapters, sidecars, and document modes. It supports normal XLSX byte import through the standalone browser host, CSV import through `DocumentFactory.createFromCsv`, blank document creation, collaboration document creation, collaboration close, resource disposal, and trap error surfacing.
- `document/document-manager.ts` is the interface consumed by React hooks, project service, active-recency, and trap recovery. It is the contract boundary for handle lookup, loading/error snapshots, subscriptions, sidecar access, document mode access, disposal, and recovery error bridging.
- `project/project-service.ts` owns project folder state, open-file metadata, active tab state, project tree refresh, file open/new/close/save/rename/delete/import flows, recent project storage, and window-title updates. It coordinates with `DocumentManager` but writes project state through the shell store.
- `project/ipc-types.ts`, `project/tauri-ipc.ts`, and `project/mock-ipc.ts` define the JS side of the Tauri file/project command boundary and its unit-test implementation.
- `shell-service.ts` composes `DocumentManager`, `ProjectService`, and the shell store into the public `ShellService` facade from `@mog-sdk/types-document`. It is the typed replacement for spreadsheet handlers reaching through `window.__SHELL__`.
- `trap-recovery/trap-recovery-coordinator.ts` observes every open document handle for wasm traps, marks all docs failed on the first trap, resets the WASM module, recovers healthy siblings, clears recovered sibling errors, and refuses further recovery loops in the same page lifecycle.
- `recent-docs/recent-docs-slice.ts` mirrors the kernel IndexedDB Meta API into a zustand store for boot precedence and recent-doc UI.
- `active-document-recency.ts` observes active file transitions and touches user-visible, locally persisted normal documents in the Meta API.
- `lifecycle-state.ts` aggregates shell-side lifecycle flags and active-document providers for devtools persistence getters, unload flushing, read-only provider state, and per-doc persistence snapshots.
- `capabilities/registry.ts` and `capabilities/audit-log.ts` implement the shell capability registry, grants, scoped checks, event subscriptions, expiry cleanup, permissive registry mode, and in-memory audit log.
- `document/imported-pivot-metadata.ts` extracts pivot metadata from imported XLSX bytes and attaches it to the shell-owned document handle.
- `collab-room.ts` resolves collaboration room configuration used by shell/bootstrap and app collaboration flows.

The folder already has meaningful focused coverage: project operations, tree utilities, project errors, document import identity and disposal races, collaboration creation/close behavior, imported pivot metadata, active-document recency, recent docs IDB mirroring, capability grants/audit logging, and both unit and integration trap-recovery scenarios.

## Improvement objectives

1. Make service ownership explicit and mechanically enforced: `DocumentManager` owns kernel handles and document runtime state, `ProjectService` owns project/open-file state, `ShellService` only exposes a public facade, recent-doc services own Meta recency mirroring, capability services own policy grants, and trap recovery only coordinates recovery over `DocumentManager`.

2. Replace ad hoc path string handling with a production path-authority contract that is OS-aware, boundary-safe, and shared by project service, mock IPC, Tauri IPC, tree utilities, and file-operation tests.

3. Make project/file operations transactional. Store state, document handles, file bytes, window titles, recent projects, and file tree refreshes should either commit in the intended order or leave an explicit, recoverable error state.

4. Split the 1000-line `createDocumentManager` implementation into narrow modules without changing the singleton facade, so normal imports, blank documents, collaboration documents, resource disposal, mode conflicts, generation aborts, and trap-error bridging each have an auditable contract.

5. Introduce typed shell service errors and diagnostics across document, project, path, capability, recency, and recovery services. Logs should remain useful, but production callers should not need to parse raw `Error.message` strings.

6. Strengthen the public `ShellService` contract so action handlers can depend on typed document lifecycle state instead of reaching into shell internals or duplicating active-file logic.

7. Make capability policy durable and host-explicit. The default in-memory registry is useful for a shell instance, but grants, expiry, audit retention, permissive mode, and host-supplied policy need a clearer authority boundary.

8. Treat recent document recency and recent projects as separate contracts with explicit cross-tab, collaboration, ephemeral, and failure semantics.

9. Preserve the trap recovery guarantees while making the private kernel-handle trap interface explicit enough to verify without structural `as` casts scattered through the shell.

10. Expand verification to cover the full service graph, including UI-driven project/file workflows where service behavior is only meaningful through actual user input paths.

## Production-path contracts and invariants to preserve or strengthen

Service ownership:

- `DocumentManager` remains the only shell service that stores live `DocumentHandle` instances and host adapter resources.
- `ProjectService` remains the only service that commits project tree, open file IDs, active file ID, and `FileMetadata` mutations.
- `ShellService` stays a facade over existing services and must not become a second document or project state store.
- React components and hooks subscribe to pre-created services. Service construction should stay in bootstrap, with legacy context fallback removed only after all production callers pass bootstrap services.
- `mog` must not depend on `mog-internal`; all implementation changes belong in public `mog` packages with internal planning retained here only.

Document lifecycle:

- Concurrent create/load for the same `fileId` must dedupe when mode-compatible and reject when normal and collaboration modes conflict.
- A dispose request racing an in-flight open must prevent late publication and must dispose any created handle or host adapter.
- `disposeAll()` must wait for in-flight opens and disposals, clear all state on non-collaboration failures, and preserve collaboration close failure semantics that keep the room-backed document registered.
- Path `DocumentSource` must not silently fall back to direct `DocumentFactory` import in the standalone shell manager. Project file opens should read bytes through IPC and pass a byte source.
- XLSX byte imports must bind the host-backed document ID to the shell `fileId`.
- CSV imports must bind `DocumentFactory.createFromCsv` to the shell `fileId`.
- Imported pivot metadata extraction must be best-effort and must not fail a successful workbook import.
- Normal, collaboration, internal, and skip-local-persistence document modes must remain visible enough for recency, trap recovery, close, and UI behavior.

Project and file lifecycle:

- Opening a project must not leave the shell half-switched if scan, auto-open, document import, or recent-project update fails.
- Opening a file must add project state only after bytes are read and the document is loaded.
- Closing a file must not remove store metadata until the relevant document resources are disposed or the close failure is explicitly represented.
- Save operations must serialize per target document/path and must avoid stale file metadata when Save As, rename, close, or delete interleave.
- `openFile` dedupe must use canonical file identity, not raw string equality.
- Window titles must reflect the committed active file/project state, not an intermediate failed operation.
- Unsupported file type, file-not-found, permission-denied, scan-failed, save-failed, and unsaved-changes errors must stay typed and exhaustively handled.

Path safety:

- Project boundary checks must be segment-aware. `/project2/file.xlsx` must never be treated as inside `/project`.
- Case handling must follow the runtime filesystem authority. TypeScript should not blindly lowercase paths on case-sensitive filesystems.
- Windows drive letters, UNC paths, mixed slashes, trailing separators, symlinks, `.` and `..`, Unicode normalization, and folder names that are prefixes of other folders must be tested.
- Rename targets must reject path separators, absolute paths, parent traversal, empty names, reserved device names where applicable, and names that the Tauri backend rejects.
- Folder delete and tree updates must use canonical descendant checks, not only `startsWith(path + '/')`.
- Mock IPC must model the same path contract as production IPC for service tests.

Trap recovery:

- First trap wins for the page lifecycle.
- Every open document sharing the dead WASM instance is marked trapped and surfaced through `DocumentManager.setError`.
- The originating trapping document remains failed.
- Healthy siblings recover on a fresh WASM module and clear `DocumentManager` errors only after successful recovery.
- Concurrent trap notifications coalesce onto one recovery.
- A later second trap after recovery is exhausted must not loop.
- Recovery listener reattachment after sibling recovery must continue to bind to the fresh core.

Capabilities:

- Capability expansion, dependency revocation, scoping, expiry, app/global subscribers, audit entries, and permissive registry mode must keep current semantics.
- Host-injected registries must remain possible through `ShellBootstrapConfig.capabilityRegistry`.
- Audit retention and pruning must not leak timers across shell disposal.
- Capability checks must remain synchronous for app hot paths unless the public capability contract is intentionally revised.

Recent docs and lifecycle/devtools:

- Recent docs mirror the kernel Meta API; it must not reach into document providers directly.
- Boot should not block first paint on recent-doc hydration, and `loaded` must still flip on read errors.
- Active document recency must skip collaboration documents and normal documents with `skipLocalPersistence`.
- Devtools persistence getters must be live-evaluated, not cached boot snapshots.
- Active-doc providers must compose multiple document caches and dedupe by `documentId` where required.
- Unload flush and beforeunload checks must enumerate every active document handle eligible for flush.

## Concrete implementation plan

### 1. Add a shell services contract map

Create a service ownership contract document in public source, preferably `shell/src/services/contracts.ts` or a small `shell/src/services/README.md`, and keep it executable where possible through types.

Define the canonical responsibilities:

- `DocumentRuntimeService`: handle lifecycle, mode metadata, host resources, load/create/close/dispose, document runtime errors.
- `ProjectWorkspaceService`: project path, file tree, open-file metadata, active tab, save/rename/delete/import operations.
- `ShellDocumentFacade`: public action-handler facade implemented by `createShellService`.
- `CapabilityAuthority`: grants, checks, audit, expiry, host policy.
- `RecencyMirror`: Meta API hydration/touch/forget and active-doc touch observer.
- `RecoveryCoordinator`: trap observation and recovery over currently open docs.

Then add compile-time type boundaries:

- Export service interfaces from the existing barrels without exposing private implementation helpers.
- Keep `DocumentManager` free of shell store imports.
- Keep `ProjectService` free of direct kernel factory imports except through `DocumentManager`.
- Keep `ShellService` free of direct host adapter or kernel creation.
- Add focused tests or type tests that ensure action handlers only consume the public `ShellService` contract from `@mog-sdk/types-document`.

### 2. Introduce a project path authority

Add a `project/path-authority.ts` module with an injectable `ProjectPathAuthority` interface:

- `canonicalize(path): Promise<ProjectCanonicalPath>`
- `isWithinProject(projectRoot, candidate): Promise<boolean>`
- `join(parent, childName): Promise<ProjectCanonicalPath>`
- `basename(path)`, `dirname(path)`, and `extension(path)` for display and type detection, using the canonical representation where possible
- `validateChildName(name, operation)` for rename, create spreadsheet, and create folder flows
- `isDescendant(parent, candidate)` for folder delete and tree operations

For desktop production, implement the authority through Tauri/Rust-backed canonical path operations so symlinks, case sensitivity, drive prefixes, UNC paths, and platform-specific reserved names are decided by the filesystem authority. Extend `ProjectIpc` and `createTauriIpc` only if no existing platform command can supply this. If a new Tauri command is needed, add it as a secured command with Rust tests and command registry coverage.

For unit tests, extend `createMockIpc` or add a mock path authority that deliberately models:

- POSIX case-sensitive paths
- Windows case-insensitive paths
- Similar prefixes such as `/project` vs `/project2`
- Mixed separators
- Symlink-like aliases if the production command resolves symlinks

Refactor `ProjectService` to use the authority in:

- `validatePathInProject`
- `openFile` duplicate detection
- `saveFile` Save As validation
- `renameFile` target construction
- `deleteFile` descendant close detection
- `createSpreadsheetInFolder`
- `createFolder`
- `importFiles`
- recent project path identity

This is the highest-priority structural improvement because security and data-loss behavior depend on it.

### 3. Make project operations transactional

Add a `ProjectOperationCoordinator` or equivalent internal helper that stages project mutations and commits them only after required side effects succeed.

Implement transaction patterns:

- `openProject`: preflight canonicalize and scan the new project before disposing old documents. Then close old files, commit project metadata/tree, update recent projects, and auto-open the first spreadsheet as a separate non-fatal child operation with explicit warning state.
- `openSingleFile`: preflight canonicalize, validate supported type, read bytes, load document, then commit single-file project state and active file metadata.
- `openFile`: read bytes and load document before adding `FileMetadata`, `openFileIds`, or active ID. If any post-load store commit fails, dispose the just-created document.
- `newFile`: create the document first, then commit store metadata. If commit fails, dispose the new handle.
- `closeFile`: for normal documents, dispose first and then remove state. For collaboration documents, surface close failure and keep state consistent with `DocumentManager`.
- `saveFile`: serialize per file ID or canonical target path instead of a global mutex. Capture the file metadata snapshot before writing and re-check after write before committing `filePath`, `displayName`, `isModified`, and `lastSaved`.
- `renameFile`: validate child name, perform IPC rename, then atomically update open metadata and tree refresh. If tree refresh fails after a successful rename, keep metadata correct and surface a refresh error.
- `deleteFile`: compute the full canonical close set before deleting. Close affected docs, delete through IPC, then refresh tree or remove entries. If close fails, do not delete.

Represent operation status in typed results or typed service errors so UI callers can show precise recovery actions.

### 4. Split `createDocumentManager` into auditable modules

Keep `createDocumentManager(options): DocumentManager` as the public factory, but move internal responsibilities behind local modules:

- `document/state-store.ts`: maps, snapshots, listeners, state notifications, and immutable `DocumentManagerState`.
- `document/operation-queue.ts`: per-file operation chain, generation allocation, dispose-request generation fencing, and manager disposed state.
- `document/open-normal.ts`: XLSX byte import, CSV import, blank document creation, runtime asset config, imported pivot metadata enrichment, identity checks, and path-source rejection.
- `document/open-collaboration.ts`: room URL canonicalization, collaboration bootstrap, mode matching, sidecar publication, collaboration close, and collaboration-specific disposal failures.
- `document/resources.ts`: host adapter, sidecar, handle disposal, cleanup ordering, and aggregate disposal failures.
- `document/errors.ts`: `DocumentOpenAbortedError`, `DocumentModeConflictError`, manager-disposed errors, import identity errors, and structured error conversion.
- `document/lifecycle-registration.ts`: active-doc provider registration for unload flush and devtools persistence state.

Add tests at module seams where they protect production behavior:

- generation aborts
- late publication prevention
- same-id dispose then reopen
- disposeAll with in-flight opens
- collaboration close failure retention
- CSV/XLSX identity mismatch
- path source rejection
- imported pivot metadata warning behavior

Do not change the `DocumentManager` interface until call sites and tests demonstrate a real missing contract.

### 5. Add typed shell service errors and diagnostics

Extend the existing `ProjectError` pattern into a broader service error taxonomy:

- `ProjectPathError`: outside project, invalid child name, unsupported path form, canonicalization failed.
- `ProjectOperationError`: open failed, close failed, save failed, rename failed, delete failed, import failed, scan failed, tree refresh failed.
- `DocumentRuntimeError`: import failed, identity mismatch, mode conflict, open aborted, manager disposed, collaboration close failed, trap surfaced.
- `CapabilityPolicyError`: invalid grant, expired grant used, persistence unavailable, audit export failed.
- `RecencyError`: meta read/write failed, hydration failed, touch skipped with reason if callers need diagnostics.
- `RecoveryError`: reset failed, sibling recovery failed, exhausted recovery.

Each error should carry:

- `service`
- `operation`
- relevant IDs and paths
- stable `type`
- `cause`
- user-safe message
- developer diagnostic message

Update service tests to assert error types, not only message substrings.

### 6. Strengthen the public `ShellService` facade

Review every spreadsheet action handler that still needs shell document behavior and ensure it can use `ShellService` only.

Potential public contract updates in `types/document/src/shell/types.ts`:

- Include loading state and error snapshot per file if handlers need to gate actions after open/recovery.
- Include `filePath`, `isModified`, `lastSaved`, and `documentType` if handlers currently reach into project state to save or display.
- Include document mode summary where handlers need to distinguish collaboration, internal, and skip-local-persistence docs.
- Return typed close results instead of `boolean` if callers need to distinguish "nothing active", "unsaved blocked", and "close failed".

Implementation requirements:

- Move ID generation to one shell utility used by `ProjectService` and `ShellService`.
- Keep platform file handles in the facade only if they are purely action-handler state. If they become project/document metadata, move them to the correct owner with an explicit lifetime contract.
- Add `shell-service.test.ts` for the facade: load bytes, infer CSV/XLSX, tab state commit, handle set/clear, new document delegation, close active clearing handle, active document switching, unsaved state passthrough, and failed `DocumentManager.loadDocument` rollback.
- Remove remaining production `window.__SHELL__` reach-arounds only after the facade exposes the full needed contract.

### 7. Make capability policy durable and explicit

Keep `InMemoryShellCapabilityRegistry` for tests and ephemeral shells, but add a production capability authority plan:

- Define `ShellCapabilityStorage` for persisted grants and audit entries, injected from host/platform when persistence is desired.
- Make session-only grants explicitly excluded from persistence.
- Rehydrate grants at shell bootstrap before app capability prompts can run.
- Persist grant, revoke, revokeAll, expiry cleanup, and audit log updates as part of the registry operations.
- Add a clock dependency for deterministic expiry and audit tests.
- Add a policy mode enum: `strict`, `permissive-dev`, `host-managed`, rather than hiding permissive behavior behind a factory that can be mistaken for production policy.
- Add diagnostics for grant expansion and dependency revocation so UI can explain why a dependent capability disappeared.

Tests should cover scoped grants, wildcard/resource matching, expiry cleanup events, persisted rehydration, session-only exclusion, audit retention, CSV export escaping, disposal clearing intervals, and host-managed registry injection through `createShell`.

### 8. Clarify recent docs, active recency, and recent projects

Document and enforce three separate recency concepts:

- Kernel Meta recent docs: document IDs persisted by the document provider/orchestrator.
- Active document recency: active tab transitions for user-visible normal local documents.
- Recent projects: desktop project folders stored through project IPC.

Implementation improvements:

- Add a typed result from `active-document-recency` for skipped touches in tests: no active file, missing handle, ID mismatch, collaboration mode, skip-local-persistence, duplicate active doc, disposed.
- Add optional cross-tab notification using `BroadcastChannel` or an equivalent Meta API event if the kernel storage layer already exposes one. If not, keep visibility refresh but make the limitation explicit in the service contract.
- Add recency operation errors to the common service diagnostic shape while preserving the current "loaded flips true even on hydrate failure" boot invariant.
- Keep recent projects in `ProjectService` and recent docs in `recent-docs`; do not merge them into one store.

Tests should cover active switches among multiple open docs, collaboration skip, ephemeral skip, ID mismatch skip, touch failure recovery, hydrate failure, forget/touch refresh, and recent-project ordering.

### 9. Make trap recovery's private handle contract explicit

Move the `_trapRecovery` shape out of an inline structural type into one authoritative contract. The best location is a narrow kernel internal type exported for shell recovery, or a shell-local adapter module if the kernel boundary should stay private.

Add `document/trap-recovery-adapter.ts`:

- `getTrapRecovery(handle): HostDocumentTrapRecovery | null`
- runtime guard
- adapter-specific diagnostics when a loaded document lacks trap recovery support

Then refactor the coordinator to depend on the adapter instead of direct `_trapRecovery` access.

Preserve and expand tests for:

- handles already loaded before coordinator construction
- handles loaded after construction
- no double-attach across unrelated manager notifications
- first trap marking every doc
- sibling recovery and error clearing
- sibling recovery rejection
- concurrent traps coalescing
- exhausted second trap
- listener reattach after recovered bridge swap
- coordinator disposal
- collaboration documents, skip-local-persistence documents, and documents closed during recovery

### 10. Align bootstrap and legacy context behavior

`createShell()` already creates services before React mounts. `ProjectServiceProvider` still has a legacy fallback that creates a `DocumentManager` inside React when no bootstrap service is passed.

Plan:

- Audit production providers to ensure every app root passes bootstrap-created `documentManager`, `projectService`, `shellService`, `recentDocsStore`, and `capabilityRegistry`.
- Add tests for `createShell()` disposal ordering: menu sync, trap recovery, active recency, event dispatcher, capability registry if owned, then document manager disposal.
- Once production roots are migrated, remove the fallback that creates `DocumentManager` inside `ProjectServiceProvider`.
- Keep testing providers explicit by requiring test code to pass mock services rather than relying on hidden creation.

This reduces the risk of two `DocumentManager` instances owning the same visible shell state.

### 11. Add service graph integration tests

Create focused integration tests that use the real services together with mock platform/path/IPC implementations:

- Bootstrap creates one document manager, one project service, one shell service, one recent-doc store, one capability registry, and one trap coordinator.
- Opening a project scans, auto-opens the first spreadsheet, loads document bytes, commits file metadata, updates active state, and touches recent projects without touching document recency until the document is locally persisted and active.
- Opening a second file and switching tabs updates active recency only for eligible docs.
- Closing an active file disposes the document and selects the adjacent active file.
- Save As uses canonical path validation and updates metadata only after write success.
- Rename/delete/import paths use canonical descendant checks.
- Trap recovery through the real service graph marks project-visible docs errored and recovers siblings.
- Shell disposal drains recency and trap listeners and disposes documents exactly once.

Keep unit tests for narrow modules, but make these integration tests the contract that the services compose correctly.

## Tests and verification gates

Future implementation should run the smallest relevant gates during each slice and the full shell gates before claiming done.

TypeScript gates:

- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/services/project/project-service.test.ts src/services/project/tree-utils.test.ts`
- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/services/document/create-document-manager.test.ts src/services/document/imported-pivot-metadata.test.ts`
- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/services/trap-recovery/__tests__/trap-recovery-coordinator.test.ts src/services/trap-recovery/__tests__/trap-recovery-integration.test.ts`
- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/services/capabilities/__tests__/shell-capability-registry.test.ts src/services/recent-docs/__tests__/recent-docs-slice.test.ts src/services/active-document-recency.test.ts`
- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test`
- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm typecheck`

Public type contract gates when `types/document/src/shell/types.ts` changes:

- Run the relevant `@mog-sdk/types-document` type/build gate.
- Run `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm typecheck`.
- Run app/package type gates for action handlers that consume `ShellService`.

Rust/Tauri gates if path authority adds or changes Tauri commands:

- Run the relevant Rust command tests for the Tauri command crate.
- Run the generated command registry test that covers hand-written command registration.
- Run the matching shell service tests against `createTauriIpc` typings and mock IPC.

UI and E2E gates for project/file workflow changes:

- Start the production dev server used by the shell/spreadsheet app.
- Exercise open project, open file, Save As, rename, delete, import, tab switch, close active tab, and trap/recovery-visible error states through real UI input paths: dialogs where available, keyboard shortcuts, menu actions, mouse clicks, drag/drop, and clipboard where relevant.
- Do not mutate shell store or service maps directly in E2E setup to bypass the UI path.
- Verify desktop/Tauri workflows separately from browser-only workflows when native file operations are involved.

Negative and edge-case tests to add:

- `/project` vs `/project2`
- `/project/file.xlsx` vs `/project-file.xlsx`
- trailing slash project roots
- mixed slash and backslash paths
- Windows drive letters and UNC paths in mock authority
- case-sensitive and case-insensitive path modes
- rename names containing `/`, `\`, `..`, absolute paths, empty names, and reserved names
- symlink-resolved outside project when the production authority supports symlink canonicalization
- save while rename or close is in flight
- delete folder with open descendants using mixed separators
- `DocumentManager.disposeAll()` while project close and trap recovery are in flight
- active recency touch failure followed by a later valid touch
- capability expiry cleanup while subscribers are active

## Risks, edge cases, and non-goals

Risks:

- Path authority is security-sensitive. A TypeScript-only normalization pass would look cleaner but would not be authoritative for Tauri desktop filesystems.
- Transactional project operations can expose existing hidden assumptions in UI code that expected intermediate store mutations during open/close.
- Splitting `createDocumentManager` can regress subtle race behavior if generation fencing and operation queue ownership are not preserved exactly.
- Public `ShellService` expansion affects package boundaries. Changes must be coordinated through `@mog-sdk/types-document`, not shell-only local types.
- Capability persistence changes can accidentally persist session-only or dev-permissive grants if policy mode is not explicit.
- Trap recovery tests use private runtime behavior. Moving the trap adapter contract should make the privacy boundary clearer, not broaden arbitrary kernel internals.

Edge cases:

- Project scan succeeds but auto-open fails.
- Existing project has unsaved documents when opening a new project.
- Collaboration document final close fails.
- CSV import succeeds through legacy path while XLSX import uses host-backed path.
- Imported pivot metadata extraction fails on malformed ZIP content.
- Multiple documents share a document ID during transitional boot or test paths.
- Active file metadata exists but the document handle was disposed by recovery or close.
- `disposeAll()` races with a new document open.
- Recent-doc hydration fails while boot precedence waits on `loaded`.
- Capability audit prune interval fires during shell disposal.

Non-goals:

- Do not move document persistence ownership out of kernel/providers.
- Do not make project service parse XLSX/CSV directly.
- Do not add a second source of truth for open documents in `ShellService`.
- Do not make E2E tests green by direct store mutation or test-only service knobs.
- Do not weaken collaboration close semantics to simplify disposal.
- Do not remove devtools lifecycle getters unless their consumers are migrated to an equivalent production-observable contract.

## Parallelization notes and dependencies on other folders, if any

Natural parallel slices:

1. Path authority and project transactions: owner of `shell/src/services/project/*`, with possible dependency on Tauri command files and generated command registry if new canonicalization commands are needed.

2. Document manager modularization: owner of `shell/src/services/document/*`, preserving the `DocumentManager` interface and existing tests.

3. Shell facade and public types: owner of `shell/src/services/shell-service.ts`, `types/document/src/shell/types.ts`, and spreadsheet action-handler consumers.

4. Capability policy: owner of `shell/src/services/capabilities/*` and bootstrap registry injection tests.

5. Recency/lifecycle services: owner of `shell/src/services/recent-docs/*`, `active-document-recency.ts`, and `lifecycle-state.ts`.

6. Trap recovery adapter: owner of `shell/src/services/trap-recovery/*` plus the narrow kernel internal type if the adapter contract is exported from kernel.

7. Service graph integration tests and UI E2E: owner of shell/bootstrap, test harnesses, and app-level UI workflows.

Dependencies:

- `types/document/src/shell/types.ts` is the public contract for `ShellService`; facade changes must land with consuming action handlers.
- `shell/src/bootstrap/create-shell.ts` owns service construction and disposal ordering.
- `shell/src/context/project-service-context.tsx` has legacy fallback construction that should only be removed after production roots use bootstrap services.
- Tauri project/file commands and generated command registry are dependencies if path authority requires new native canonicalization commands.
- Kernel/internal trap recovery types are a dependency if the private `_trapRecovery` contract moves out of shell structural typing.
- Spreadsheet UI and action handlers are dependencies for E2E verification and for removing `window.__SHELL__` reach-arounds.
