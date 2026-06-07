# Shell

> **Status: workspace-internal implementation; public package reserved.**
> `shell/package.json` names the package `@mog/shell`, sets
> `"private": true`, and `tools/package-inventory.jsonc` marks `@mog/shell`
> as `reserved`. It is used inside the monorepo and by the trusted
> `@mog-sdk/spreadsheet-app` bundle composition path. External hosts should
> use public runtime packages such as `@mog-sdk/spreadsheet-app`,
> `@mog-sdk/embed`, `@mog-sdk/sheet-view`, or `@mog-sdk/sdk` instead of
> importing `@mog/shell` directly.

The shell package owns workspace app hosting, shell-level bootstrap services,
shared contexts, focus state, capability prompts, project/document UI services,
and reusable React UI primitives. Spreadsheet-specific chrome, commands,
selection, editing, ribbon state, and grid workflow orchestration live in
`apps/spreadsheet`, not in `shell`.

## Source Map

```
shell/
├── package.json             # private @mog/shell workspace package
├── src/
│   ├── index.ts             # workspace-internal root barrel
│   ├── app-launcher/        # capability-gated app launch flow
│   ├── apps/                # app switcher/logo UI and app component types
│   ├── bootstrap/           # createShell(), event dispatcher, bootstrap types
│   ├── components/          # shell UI primitives, files, settings, titlebar, consent UI
│   ├── context/             # store, platform, document manager, project, capability contexts
│   ├── contexts/            # portal container context
│   ├── hooks/               # shell hooks plus keyboard and app-data subpaths
│   ├── host/                # ShellHost, AppSlot, app loader, setup/binding UI
│   ├── host-adapters/       # standalone browser host and blocked hosted-workspace skeleton
│   ├── lib/                 # file type registry and path helpers
│   ├── machines/            # shell-level state machines
│   ├── platform/            # app/plugin platform scaffolding and validators
│   ├── selectors/           # shell selectors
│   ├── services/            # document, project, capabilities, recent docs, trap recovery
│   ├── styles/              # CSS entry points
│   └── ui-store/            # Zustand shell UI store and slices
├── __mocks__/
├── jest.config.cjs
└── tsconfig.json
```

## Package Boundary

`@mog/shell` is not a shipped public app-builder dependency. Its package
exports are for workspace consumers and trusted runtime composition:

- `.` re-exports UI primitives, host components, app launcher helpers, focus
  machine helpers, shell contexts, shell store, bootstrap helpers, capability
  runtime helpers, and selected services.
- Subpaths include `./bootstrap`, `./context`, `./components`,
  `./components/ui`, `./capabilities`, `./hooks`, `./hooks/keyboard`,
  `./hooks/app-data`, `./styles`, `./platform`, `./host/app-registry`,
  `./apps`, and `./apps/types`.
- `shell/src/platform/package-boundary-validator.ts` treats bare
  `@mog/shell` and most `@mog/shell/*` imports as forbidden for third-party
  apps/plugins. The current allowance for `@mog/shell/platform` is for the
  workspace-internal app/plugin platform scaffolding, not a published plugin
  SDK.
- Public full-app embedding is through `runtime/spreadsheet-app`
  (`@mog-sdk/spreadsheet-app`), which composes shell/app internals behind a
  declaration boundary.

## Bootstrap

`createShell()` in `shell/src/bootstrap/create-shell.ts` is async and runs
before React mounts. It currently creates or resolves:

| Bootstrap output | Current behavior |
| --- | --- |
| `platformIdentity` | Synchronous platform identity from `@mog/platform/identity`. |
| `store` | A shell-level Zustand store with navigation, record-detail, and project slices. |
| `recentDocsStore` | A recent-docs store hydrated from the kernel IndexedDB Meta API without blocking first paint. |
| `platform` | Injected platform, Tauri platform, or web `createPlatform(new MemoryFileSystem())`; may be `null` if platform initialization fails. |
| `documentManager` | Shell-lifetime document manager for create/load/import/dispose and collaboration document modes. |
| `projectService` | Project and file-tree service when a platform is available. |
| `shellService` | Thin document/project facade used by action handlers when `projectService` exists. |
| `eventDispatcher` | Tauri menu-event dispatcher with React-provided handlers for UI-owned actions. |
| `capabilityRegistry` | Injected registry or shell-owned in-memory registry. |
| `dispose()` | Disposes menu sync, trap recovery, active-doc recency, event dispatcher, capability registry, and all documents. |

The bootstrap also installs devtools persistence/read-only getters, active
document recency mirroring, IndexedDB eviction reporting, trap recovery, and
desktop menu shortcut synchronization. These are implementation details of the
workspace shell/runtime, not public setup requirements.

## App Hosting

The current hosted app path is same-realm, first-party React code:

1. `apps/spreadsheet/register.ts` imports
   `@mog/shell/host/app-registry` and calls `registerApps()` as a side effect.
2. `runtime/spreadsheet-app/src/index.tsx` imports that registration side
   effect before exporting the public full-app runtime facade.
3. `ShellHost` reads `activeAppId` from the shell store, renders optional
   header/sidebar/file-explorer chrome, and places the active app in `AppSlot`.
4. `AppSlot` resolves the manifest from the mutable app registry, runs setup
   and binding flows when `managedTables` are declared, calls `launchApp()` for
   capability gating, and wraps the app in Suspense plus `ErrorBoundary`.
5. `AppLoader` lazily loads the registered app component and passes the
   capability-gated `kernel`, manifest, bindings, feature gates, and appearance
   callbacks.

The product-neutral platform path under `shell/src/platform/` has registries,
resource binding, host services, contribution resolution, trust integration,
package-boundary validation, and an isolation enforcer. It is
workspace-internal scaffolding today. `same-realm-first-party` apps and
registered `same-realm-trusted` bundled plugins are the only executable
same-realm modes, but the plugin registry is still an empty stub until
plugin-kind packages are supported. Iframe, worker, server-side, and
remote-bridge app/plugin hosts are reserved or not shipped.

## Services

| Area | Source | Current role |
| --- | --- | --- |
| Document lifecycle | `shell/src/services/document/` | Loads XLSX/CSV bytes or paths through `DocumentFactory`, creates blank documents, manages collaboration documents/sidecars, deduplicates concurrent opens, exposes state subscriptions, and disposes documents. |
| Project/files | `shell/src/services/project/` | Manages project folder state, file tree, open tabs, active file, save mutex, path-in-project checks, recent projects, and platform IPC/dialog calls. |
| Shell service | `shell/src/services/shell-service.ts` | Facade over `DocumentManager` and `ProjectService` for action handlers: load document bytes, new document, close active document, set active document, track live file handles, and inspect unsaved state. |
| Capabilities | `shell/src/services/capabilities/` and `shell/src/context/capability-context.tsx` | In-memory shell capability registry/audit log plus launch/runtime consent dialogs. This is a same-process capability gate, not a sandbox. |
| Recent docs | `shell/src/services/recent-docs/` and `active-document-recency.ts` | Mirrors kernel meta recency into shell state and touches user-visible active documents unless collaboration or host-owned ephemeral mode opts out. |
| Trap recovery | `shell/src/services/trap-recovery/` | Observes document handles for WASM traps, marks failed docs, resets the WASM module, and coordinates one recovery pass for healthy siblings. |
| Collaboration room config | `shell/src/services/collab-room.ts` | Resolves collaboration room settings used by shell/runtime collaboration flows. |

## UI Primitives

UI primitives live in `shell/src/components/ui/` and are exported from both
`@mog/shell/components/ui` and the workspace-internal root barrel. They include:

- base controls: `Button`, `Input`, `Textarea`, `Label`, `FormField`,
  `IconButton`, `Icon`, `ColorInput`, `ColorSwatch`, `StatusBadge`,
  `ConnectionBadge`, `EmptyState`, `Listbox`, `MenuItem`, `SectionLabel`
- Radix-backed controls: `Dialog`, `Popover`, `DropdownMenu`, `ContextMenu`,
  `Tooltip`, `Tabs`, `Accordion`, `Checkbox`, `RadioGroup`, `Switch`,
  `SegmentedControl`

The primitives use semantic shell design tokens such as `bg-ss-surface`,
`text-ss-text`, `border-ss-border`, and Radix data attributes for overlay and
choice behavior. They are stable for workspace app code, but they are not a
public design-system package.

## State Machines and Store

`shell/src/machines/focus-machine.ts` exports the shell-level `focusMachine`.
It is an XState machine with a stack-based focus model, no DOM access, and a
maximum stack depth of 10. Current focus states include `grid`, `editor`,
`formulaBar`, `dialog`, `commandPalette`, `contextMenu`, `formulaPicker`, and
`sheetTabs`. App input systems coordinate DOM focus and keyboard routing around
this machine.

`shell/src/ui-store/shell-store.ts` creates a small shell-lifetime Zustand
store. Current slices are:

| Slice | State |
| --- | --- |
| `navigation` | `activeViewId`, `viewSwitcherOpen`, and `activeAppId` (default `spreadsheet`). |
| `record-detail` | Active table/row detail sidebar state. |
| `project` | Project path/name, file tree, open file IDs, active file, file metadata, loading state, recent projects. |

Document-specific UI state, selection/editing state, ribbon state, dialogs, and
spreadsheet command routing are app-level concerns in `apps/spreadsheet`.

## Host Adapters

`shell/src/host-adapters/standalone-browser-host.ts` constructs the trusted
standalone browser host context used by the shell document manager. It provides
host identity, runtime config, diagnostics, host authorization defaults,
IndexedDB provider configuration, replay protection, and adapter bindings for
the kernel host contract.

`shell/src/host-adapters/hosted-workspace-browser-host-skeleton.ts` is a
compile-check skeleton that throws if used. Hosted workspace/SaaS host behavior
is blocked on runtime services, app/plugin platform work, storage lifecycle,
and verification contracts; it must not fall back to standalone-shell defaults.
