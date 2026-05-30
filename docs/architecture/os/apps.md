# Apps

Mog has two app-related surfaces:

- **Workspace-internal shell apps** are TypeScript/React packages under `apps/`
  that are loaded by the private `@mog/shell` host.
- **Public app embeds** are runtime facades such as `@mog-sdk/spreadsheet-app`
  that package the shipped spreadsheet app for trusted same-origin hosts.

External host code should use `@mog-sdk/spreadsheet-app` for the full
spreadsheet application or `@mog-sdk/embed` for lower-level sheet/view embeds.
Do not import `@mog/app-spreadsheet`, `@mog/shell`, or `@mog/ui` from external
applications.

## Current Apps

| Surface | Package | Status | Purpose |
| --- | --- | --- | --- |
| `apps/spreadsheet` | `@mog/app-spreadsheet` | workspace-internal | Shipped first-party spreadsheet app. Owns the workbook chrome, formula bar, sheet tabs, dialogs, panels, grid integration, and document UI state. |
| `runtime/spreadsheet-app` | `@mog-sdk/spreadsheet-app` | public | Full spreadsheet app embed facade. Exports `createSpreadsheetRuntime`, `MogSpreadsheetApp`, `mountSpreadsheetApp`, public types, and CSS assets while hiding private shell/app/kernel implementation types from declarations. |
| `runtime/embed` | `@mog-sdk/embed` | public-experimental | Lower-level sheet/view embed package. It is not a shell app and does not expose the full spreadsheet chrome. |
| Third-party shell apps/plugins | n/a | reserved / not shipped | The repository has workspace-internal app/plugin platform scaffolding, but public third-party app authoring, marketplace distribution, and sandboxed app hosts are not shipped. |

## Spreadsheet App Structure

```
apps/spreadsheet/
├── index.tsx               # Package entry point; re-exports the app and ShellProvider
├── register.ts             # Side-effect registration into @mog/shell/host/app-registry
├── manifest.ts             # Legacy capability manifest consumed by AppSlot
├── package.json            # Private @mog/app-spreadsheet workspace package
├── tsup.config.ts          # Bundle entries for app, manifest, register, chrome, hooks
├── tsconfig.json
├── jest.config.cjs
├── jest.setup.cjs
├── __mocks__/              # Test mocks
├── src/
│   ├── index.tsx           # Main app component and app-owned chrome
│   ├── canonical-manifest.ts # Product-neutral platform manifest
│   ├── exports.ts          # Workspace-internal app surface
│   ├── internal-api.ts     # Cycle-safe internal source barrel
│   ├── actions/            # User actions
│   ├── adapters/           # Integration adapters
│   ├── app/                # App-level setup
│   ├── cache/              # Caching layer
│   ├── chrome/             # Toolbar, formula bar, sheet tabs
│   ├── components/         # App-specific UI components
│   ├── coordinator/        # View coordination
│   ├── dev/                # Development-only app surfaces
│   ├── devtools/           # App devtools integration
│   ├── dialogs/            # Dialog components
│   ├── domain/             # App domain logic
│   ├── entries/            # Package subpath entries
│   ├── extensions/         # Feature extensions
│   ├── hooks/              # App-specific hooks
│   ├── infra/              # Infrastructure
│   ├── keyboard/           # Keyboard shortcut handling
│   ├── pivot/              # Pivot table UI
│   ├── selectors/          # App-local selectors
│   ├── systems/            # App subsystems and state machines
│   ├── ui-store/           # App UI state
│   ├── ux/                 # Interaction helpers
│   ├── utils/              # Utilities
│   └── views/              # App-contributed views
```

## Kernel API Usage

Workspace-internal shell apps receive `AppProps` from `@mog/shell/apps`.
`AppProps.kernel` is the capability-gated `IGatedAppKernelAPI` from
`@mog-sdk/contracts/capabilities`. The ungated `IAppKernelAPI` contract lives in
`@mog-sdk/contracts/apps`.

The gated API always includes capability introspection. Domain sub-APIs such as
`tables`, `records`, `cells`, and `filesystem` are optional, and methods inside
partial sub-APIs may also be absent when a capability is not granted.

```typescript
import type { AppProps } from '@mog/shell/apps';

export async function loadTables({ kernel }: AppProps) {
  if (!kernel.capabilities.has('tables:read') || !kernel.tables?.list) return [];

  return await kernel.tables.list();
}
```

The spreadsheet app is the important exception: `apps/spreadsheet/src/index.tsx`
accepts `AppProps`, but intentionally ignores the `kernel` and `manifest` props.
It uses the shell `DocumentManager` subscription (`useDocument`) to obtain a
trusted document handle, then creates its workbook-facing runtime from that
handle.

## App Registration

The current shipped app uses the legacy mutable registry in
`shell/src/host/app-registry.ts`:

1. `apps/spreadsheet/register.ts` calls `registerApps()` from
   `@mog/shell/host/app-registry` with the spreadsheet manifest and lazy app
   loader.
2. `runtime/spreadsheet-app/src/index.tsx` imports
   `@mog/app-spreadsheet/register` for that side effect before exporting the
   public full-app embed facade.
3. `AppSlot` looks up the manifest, runs the capability launch flow, and builds
   a gated app API for the app component. First-party apps can be auto-granted;
   legacy/no-capability-context fallback paths use an ungated adapter.
4. `AppLoader` resolves the registered component and renders it with the gated
   `kernel`, `manifest`, optional `bindings`, feature gates, and appearance
   callbacks.

`apps/spreadsheet/src/canonical-manifest.ts` also defines a product-neutral
platform manifest for package-registry and contribution-resolution code. That
platform path is workspace-internal today. Current app launching supports
`same-realm-first-party`; sandbox modes such as iframe or worker app hosts are
reserved and not shipped.

## UI Primitives

Workspace-internal apps can use the shared `@mog/ui` package for
kernel-agnostic UI and data-view components:

```typescript
import { KanbanBoard } from '@mog/ui';
import type { ColumnInfo } from '@mog/ui';
```

`@mog/ui` is a private, reserved workspace package. It is useful inside the
monorepo, but it is not a public app-builder dependency.
