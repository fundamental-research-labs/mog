# Apps

Apps are TypeScript/React packages loaded by the shell. The current first-party app package under `apps/` is **spreadsheet**.

## Current Apps

| App                | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `apps/spreadsheet` | Spreadsheet app with workbook chrome, grid integration, and formulas |

## Spreadsheet App Structure

```
apps/spreadsheet/
├── index.tsx               # Package entry point
├── register.ts             # Side-effect app registration
├── manifest.ts             # App manifest
├── src/
│   ├── index.tsx           # Main app component and app-owned chrome
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
├── __mocks__/              # Test mocks
├── package.json
├── tsconfig.json
└── jest.config.cjs
```

## Kernel API Usage

Shell-hosted apps receive a capability-gated kernel API as an `AppProps.kernel` prop. The full app kernel interface is defined in `@mog-sdk/contracts/apps`; the gated interface exposes only the sub-APIs granted to the app, plus capability introspection.

```typescript
import type { AppProps } from '@mog/shell/apps';

async function loadTables({ kernel }: AppProps) {
  if (!kernel.tables?.list) return [];

  return kernel.tables.list();
}
```

## App Registration

Apps register with the shell by calling `registerApps()` from `@mog/shell/host/app-registry`. The spreadsheet package does this in `apps/spreadsheet/register.ts`, and runtime entry points import that module for its side effect. `AppSlot` launches apps through the capability flow and `AppLoader` renders the registered component.

## UI Primitives

Apps can use the shared `@mog/ui` package for kernel-agnostic UI and data-view components:

```typescript
import { KanbanBoard } from '@mog/ui';
import type { ColumnInfo } from '@mog/ui';
```
