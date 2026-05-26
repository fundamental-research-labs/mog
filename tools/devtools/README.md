# Mog DevTools

Runtime observability for Mog. It instruments shared runtimes rather than
individual apps, so current and future apps can report through the same trace
surface.

## Quick Start

Import `@mog/devtools` in development builds, then open the browser console:

```
__dt.machines()     // See all live XState machines
__dt.machine('editor')  // Inspect one machine's state + transitions
__dt.slow()         // Find everything above 16ms
__dt.timeline(1000) // Last 1000ms across all runtimes
```

## What It Traces

| Runtime | What It Captures | Integration |
|---------|-----------------|-------------|
| **XState Actors** | State transitions, events, guard rejections | `inspect` callback on `createActor()` |
| **EventBus** | Every domain event | 1 line in `emit()` |
| **React Renders** | Render timing per app boundary | `React.Profiler` wrapping AppSlot |
| **Canvas Frames** | Per-layer paint timing | Auto-enabled `debugTiming` in RenderLoop |
| **Rust Bridge** | Every Rust<->JS call with timing | Proxy wrapper on bridge objects |

## Console API

### Quick Diagnosis

```
__dt.last(10)       // Last 10 events across all runtimes
__dt.print(10)      // Same but pretty-printed
__dt.slow(16)       // Everything above 16ms (bridge, render, canvas)
__dt.timeline(500)  // ASCII timeline of last 500ms
```

### XState (most useful for "nothing happened" bugs)

```
__dt.machines()           // All live machines with current state
__dt.machine('editor')    // One machine: state, context, last transitions
__dt.transitions()        // Recent transitions across all machines
__dt.transitions('editor') // Filter by machine name
```

### EventBus

```
__dt.events()             // All domain events
__dt.events('cell')       // Filter by event type prefix
```

### React

```
__dt.renders()            // All renders with timing
__dt.renders('spreadsheet') // Filter by app
__dt.slowRenders(8)       // Renders above 8ms
```

### Canvas

```
__dt.frames(10)           // Last 10 canvas frames with per-layer timing
```

### Bridge

```
__dt.bridge()                // All bridge calls with timing
__dt.bridge('getPageBreaks') // Filter by method name
```

### Viewport Buffer

Inspect the binary viewport buffer pipeline — zero-copy cell data from Rust to canvas.
Reads state directly from `window.__SHELL__` without instrumenting kernel code.

```
__dt.viewport()              // Summary of all viewport buffers (bounds, cellCount, generation)
__dt.viewport('main')        // Detail for one viewport + 5x5 sample cell grid
__dt.cell(0, 0)              // Read cell [0,0] from any viewport buffer
__dt.cell(0, 0, 'main')      // Read cell from specific viewport
```

Useful for diagnosing "blank sheet" bugs — check if buffers are populated and cells have data.

### Export & Control

```
__dt.toJSON()             // Structured JSON (for coding agents)
__dt.enable() / __dt.disable()
__dt.clear()
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  APPS (never instrumented)                               │
├─────────────────────────────────────────────────────────┤
│  OS RUNTIMES                                             │
│  Each checks: window.__OS_DEVTOOLS__?.reportXxx(...)     │
├─────────────────────────────────────────────────────────┤
│  tools/devtools/                                         │
│  __OS_DEVTOOLS__ (runtimes report IN)                    │
│  __dt (humans/agents query OUT)                          │
│  EventStore (ring buffer, 5K events)                     │
└─────────────────────────────────────────────────────────┘
```

**Key design**: Runtimes call INTO devtools via `window.__OS_DEVTOOLS__`. DevTools never imports runtime code. Zero cost when devtools isn't loaded — a single `?.` check per event.

### Package Structure

```
tools/devtools/
├── src/
│   ├── index.ts              # setupDevTools() + auto-init
│   ├── types.ts              # RuntimeEvent union, MachineSnapshot, global types
│   ├── event-store.ts        # Ring buffer (5K capacity)
│   ├── global-hook.ts        # window.__OS_DEVTOOLS__ setup
│   ├── recorders/
│   │   └── actor-recorder.ts # XState events → structured transitions
│   └── console/
│       ├── api.ts            # window.__dt implementation
│       ├── printer.ts        # Colored console output
│       └── viewport-inspector.ts  # Viewport buffer inspection (reads via __SHELL__)
└── traces/                   # Generated trace files (gitignored)
```

## Integration Points

Changes outside this package are conditional on `__OS_DEVTOOLS__` presence:

| File | Change |
|------|--------|
| `GridEditingSystem` | `inspect` + `id` on 7 `createActor()` calls |
| `WindowManager` | `inspect` on `createActor(focusMachine)` |
| `DocumentLifecycleSystem` | `inspect` on actor creation |
| `ClipboardService` | `inspect` on actor creation |
| `ActorManager` | Fallback to devtools inspect when none provided |
| `EventBus.emit()` | `__OS_DEVTOOLS__?.reportEvent(event)` |
| `AppSlot.tsx` | `React.Profiler` wrapping app render |
| `RenderLoop` | Auto-enable debugTiming, report frame timings |
| `kernel-context.ts` | `wrapBridgeForDevTools()` on compute/pivot/schema/chart |
| `dev-app/main.tsx` | `import '@mog/devtools'` (first import) |
