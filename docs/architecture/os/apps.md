# Apps

Apps are TypeScript/React code that import kernel and shell as libraries. Currently the only app is **spreadsheet**.

## Current Apps

| App                | Purpose                       |
| ------------------ | ----------------------------- |
| `apps/spreadsheet` | Spreadsheet app with XLSX import/export and formula compatibility |

## Spreadsheet App Structure

```
apps/spreadsheet/
├── src/
│   ├── index.tsx           # Main app component
│   ├── app/                # App-level setup
│   ├── chrome/             # Toolbar, formula bar, sheet tabs
│   ├── components/         # App-specific UI components
│   ├── coordinator/        # View coordination
│   ├── dialogs/            # Dialog components
│   ├── domain/             # App domain logic
│   ├── extensions/         # Feature extensions
│   ├── hooks/              # App-specific hooks
│   ├── keyboard/           # Keyboard shortcut handling
│   ├── pivot/              # Pivot table UI
│   ├── systems/            # App subsystems
│   ├── actions/            # User actions
│   ├── cache/              # Caching layer
│   ├── ui-store/           # App UI state
│   ├── utils/              # Utilities
│   └── infra/              # Infrastructure
├── __mocks__/              # Test mocks
├── manifest.ts             # App manifest
├── package.json
├── tsconfig.json
└── jest.config.cjs
```

## Kernel API Usage

Apps access the kernel via the `useKernel()` hook. The API is organized into workbook-level and worksheet-level namespaces:

```typescript
const kernel = useKernel();

// Workbook-level operations
kernel.workbook.sheets.list();
kernel.workbook.history.undo();

// Worksheet-level operations
kernel.worksheet.setCell(sheetId, row, col, value);
kernel.worksheet.tables.create(sheetId, range);
```

## App Registration

Apps are discovered via a Vite plugin in the shell (`shell/src/apps/vite-plugin-apps.ts`). The shell's app-launcher system handles app switching and loading.

## UI Primitives

Apps use the shared `@mog/ui` package for base components:

```typescript
import { Button, Dialog, DropdownMenu, Tooltip } from '@mog/ui';
```
