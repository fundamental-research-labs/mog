# Shell

The shell provides app hosting, shell-level services, focus state, and reusable UI primitives that apps compose with their own chrome.

## Overview

```
shell/
├── src/
│   ├── host/                 # App hosting (ShellHost, AppSlot, AppLoader)
│   ├── app-launcher/         # Capability-gated app launch flow
│   ├── apps/                 # App switcher UI
│   ├── bootstrap/            # Shell initialization (create-shell, event-dispatcher)
│   ├── components/           # Shared UI components
│   ├── context/              # Shell contexts (capability, platform, document manager)
│   ├── contexts/             # Portal container context
│   ├── hooks/                # Shell-level hooks
│   ├── host-adapters/        # Browser host adapters
│   ├── machines/             # Shell-level state machines
│   ├── platform/             # App platform registries, validation, and resource binding
│   ├── selectors/            # Shell selectors
│   ├── services/             # Document, project, capability, and lifecycle services
│   ├── ui-store/             # Shell UI state (Zustand store)
│   ├── lib/                  # Utility libraries (file-type-registry, path-utils)
│   └── styles/               # Global styles
├── __mocks__/                # Test mocks
```

## State Machines

Shell machines live in `src/machines/`:

| Machine                             | Purpose                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| `focusMachine` (`focus-machine.ts`) | Stack-based keyboard focus management for shell/app focus layers |

## UI Primitives

Exported from `@mog/shell/components/ui` and re-exported from `@mog/shell`:

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
} from '@mog/shell/components/ui';
```

Overlay and choice primitives such as `Select`, `Dialog`, `Popover`, `DropdownMenu`, `ContextMenu`, `Tooltip`, `Tabs`, `Checkbox`, and `RadioGroup` wrap Radix UI. Base controls such as `Button` and `Input` are shell components styled with semantic design tokens (`bg-ss-surface`, `text-ss-text`, etc.).

## App Hosting

### ShellHost

The host renders apps and provides the app slot. Key files in `src/host/`:

| File                   | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `ShellHost.tsx`        | Top-level shell layout around the app slot |
| `AppSlot.tsx`          | Where the active app renders               |
| `AppLoader.tsx`        | Lazy-loads the active app                  |
| `AppLoading.tsx`       | Loading state while app initializes        |
| `AppCrashedState.tsx`  | Error recovery when app crashes            |
| `ErrorBoundary.tsx`    | React error boundary for apps              |
| `app-registry.ts`     | App registration and discovery             |
| `app-setup.ts`        | App initialization and setup               |
| `AppSetupDialog.tsx`   | Setup dialog for app configuration         |
| `AppBindingEditor.tsx` | Editor for app data bindings               |
