# Shell

The shell provides reusable view components and UI primitives that apps compose with their own chrome.

## Overview

```
shell/
├── src/
│   ├── host/                 # App hosting (ShellHost, AppSlot, AppLoader)
│   ├── app-launcher/         # App discovery and switching
│   ├── apps/                 # App switcher UI
│   ├── bootstrap/            # Shell initialization (create-shell, event-dispatcher)
│   ├── components/           # Shared UI components
│   ├── machines/             # View-specific state machines
│   ├── hooks/                # Shell-level hooks
│   ├── services/             # Document and project services
│   ├── context/              # Shell contexts (capability, platform, document manager)
│   ├── ui-store/             # Shell UI state (Zustand store)
│   ├── lib/                  # Utility libraries (file-type-registry, path-utils)
│   └── styles/               # Global styles
├── __mocks__/                # Test mocks
```

## State Machines

Shell machines live in `src/machines/`:

| Machine          | Purpose                              |
| ---------------- | ------------------------------------ |
| `FocusMachine`   | Focus state management within shell  |

## UI Primitives

Exported from `@mog/ui`:

```typescript
import {
  Button,
  Input,
  Select,
  Dialog,
  Popover,
  DropdownMenu,
  ContextMenu,
  Tooltip,
  Tabs,
  Checkbox,
  RadioGroup
} from '@mog/ui';
```

All primitives use Radix UI with semantic design tokens (`bg-ss-surface`, `text-ss-text`, etc.).

## App Hosting

### ShellHost

The host renders apps and provides the app slot. Key files in `src/host/`:

| File                   | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `ShellHost.tsx`        | Top-level host, provides shell context     |
| `AppSlot.tsx`          | Where the active app renders               |
| `AppLoader.tsx`        | Lazy-loads the active app                  |
| `AppLoading.tsx`       | Loading state while app initializes        |
| `AppCrashedState.tsx`  | Error recovery when app crashes            |
| `ErrorBoundary.tsx`    | React error boundary for apps              |
| `app-registry.ts`     | App registration and discovery             |
| `app-setup.ts`        | App initialization and setup               |
| `AppSetupDialog.tsx`   | Setup dialog for app configuration         |
| `AppBindingEditor.tsx` | Editor for app data bindings               |
