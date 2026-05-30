# SheetView

> **Status: low-level view package**

Use `@mog-sdk/sheet-view` to mount the Mog canvas grid inside your own application chrome. SheetView is the lower-level view package that `@mog-sdk/embed` builds on top of.

## Prerequisites

- Browser environment with DOM, `ResizeObserver`, and Canvas API support
- `@mog-sdk/sheet-view`
- A workbook object supplied by a Mog runtime or host adapter

## Install

```bash
npm install @mog-sdk/sheet-view
```

## When to Use SheetView vs. Embed

SheetView gives you a grid renderer and capability handle, not spreadsheet application chrome. It can optionally render viewport chrome such as scrollbars and zoom controls, but it does not provide a toolbar, formula bar, or sheet tabs. Use `@mog-sdk/embed` for packaged sheet/view embeds. Use `@mog-sdk/spreadsheet-app` when you need the full spreadsheet app with its own commands, formula bar, sheet tabs, and app chrome.

## Mount

Create a SheetView handle with `createSheetView()`, attach a data source, then start the render loop after any host policy wiring is complete.

```typescript
import {
  createSheetView,
  createSheetViewDataSourceFromWorkbook,
} from '@mog-sdk/sheet-view';

const view = createSheetView({
  container,
  showHeaders: true,
  showGridlines: true,
  scrollable: true,
});

view.attach(createSheetViewDataSourceFromWorkbook(workbook));
view.start();
```

SheetView deliberately keeps the canonical Workbook type outside its public package surface. Pass the workbook through `createSheetViewDataSourceFromWorkbook(workbook)` or an equivalent `SheetViewDataSource` object.

## Handle User Input

With `scrollable: true`, SheetView wires its own wheel scrolling and emits cell pointer intents for click, double-click, context-menu, and hover. Advanced hosts can pass `scrollable: false`, provide their own input policy, and drive the view through `view.viewport`, `view.commands`, and `view.renderState`.

## Handle Events

Subscribe through the events capability. Events are view-owned facts and intents such as cell pointer intent, visible range change, geometry change, scroll or zoom change, focus enter/leave, edit requests, and selection visual change.

```typescript
const subscription = view.events.subscribe((event) => {
  if (event.type === 'scroll-change') {
    console.log(event.position);
  }
});

subscription.dispose();
```

## Customization

Use the capability handle rather than renderer internals: `view.viewport` for scroll, split views, and frozen panes; `view.renderState` for visual selection/editor/clipboard state; `view.dataSources` for app-owned renderer lookups; `view.skin` for non-persistent visual skinning; and `view.overlays`, `view.decorations`, or `view.layers` for host-owned extensions.

## Performance

SheetView is canvas-based and viewport-driven. It refreshes visible workbook data through `attach()`, invalidates rendering for data, geometry, scroll, zoom, and resize changes, and exposes targeted invalidation through `view.render`.

## Lifecycle

Use `attach()` once per view, `start()` to begin rendering, `switchSheet()` for active sheet changes, `suspend()` and `resume()` for backgrounding, `resize()` for explicit sizing, and `dispose()` to release view-owned resources. Disposing the view does not dispose the attached workbook.

## Related Docs

- [Embed: Web Component](embed-web-component.md) — higher-level component with full UI
- [Embed: React](embed-react.md) — React wrapper
- [Architecture Overview](architecture-overview.md) — where SheetView sits in the layer stack
- [API Reference](../reference/README.md)
