# SheetView

> **Status: shipped public low-level view package**

Use `@mog-sdk/sheet-view` to mount the Mog canvas grid inside your own
application chrome. SheetView is the lower-level view package that
`@mog-sdk/embed` builds on top of.

## Prerequisites

- Browser environment with DOM, `ResizeObserver`, Canvas API support, and an
  ES module bundler
- `@mog-sdk/sheet-view`
- A real Mog workbook object supplied by your host/runtime adapter

## Install

```bash
npm install @mog-sdk/sheet-view
```

SheetView does not create, open, fetch, authorize, save, or export workbooks.
For a browser integration that needs package-managed XLSX loading from
host-authorized bytes, start with [`@mog-sdk/embed`](embed-web-component.md) or
[`@mog-sdk/spreadsheet-app`](spreadsheet-app-embed.md).

## When to Use SheetView vs. Embed

SheetView gives you a grid renderer and capability handle, not spreadsheet
application chrome. It can optionally render viewport chrome such as
scrollbars and zoom controls, but it does not provide a toolbar, formula bar,
or sheet tabs. Use `@mog-sdk/embed` for packaged sheet/view embeds. Use
`@mog-sdk/spreadsheet-app` when you need the full spreadsheet app with its
application command system, formula bar, sheet tabs, and app chrome.

## Mount

Create a SheetView handle with `createSheetView()`, attach a data source, then
start the render loop after any host policy or input wiring is complete.

```html
<div id="sheet-view" style="height: 600px; width: 100%"></div>
```

```typescript
import {
  createSheetView,
  createSheetViewDataSourceFromWorkbook,
  type SheetViewHandle,
  type SheetViewWorkbookSource,
} from '@mog-sdk/sheet-view';

export function mountSheetView(
  container: HTMLElement,
  workbook: SheetViewWorkbookSource,
): SheetViewHandle {
  const view = createSheetView({
    container,
    showHeaders: true,
    showGridlines: true,
    scrollable: true,
  });

  view.attach(createSheetViewDataSourceFromWorkbook(workbook));
  view.start();
  return view;
}
```

SheetView deliberately keeps the canonical Workbook type outside its public
package surface. Pass the real workbook through
`createSheetViewDataSourceFromWorkbook(workbook)`, which returns the
`SheetViewDataSource` accepted by the public handle. The
`SheetViewWorkbookSource` type is intentionally narrow; do not synthesize it
from a plain object. The runtime value must be the actual Mog workbook handle
supplied by your host/runtime adapter.

The public package exports only the root entrypoint. Do not import
implementation files such as `@mog-sdk/sheet-view/src/...`, and do not import
the workspace-internal `@mog/*` renderer packages in public integrations.

## Handle User Input

With `scrollable: true`, SheetView wires its own wheel scrolling and emits cell
pointer intents for click, double-click, context-menu, and hover. Advanced
hosts can pass `scrollable: false`, provide their own input policy, and drive
the view through `view.viewport`, `view.commands`, and `view.renderState`.

## Handle Events

Subscribe through the events capability. Emitted events are view-owned facts
and intents such as cell pointer intent, visible range change, geometry
change, scroll or zoom change, focus enter/leave, selection visual change, and
API-triggered edit-start intent.

```typescript
const subscription = view.events.subscribe((event) => {
  if (event.type === 'scroll-change') {
    console.log(event.position);
  }
});

subscription.dispose();
```

## Customization

Use the capability handle rather than renderer internals: `view.viewport` for
scroll, split views, and frozen panes; `view.renderState` for visual selection,
editor, clipboard, remote cursor, view-option, theme, shimmer, page-break,
preview-font, and search-highlight state; `view.objects` for rendered floating
object scene operations; `view.dataSources` for app-owned renderer lookups;
`view.skin` for non-persistent visual skinning; and `view.overlays`,
`view.decorations`, or `view.layers` for host-owned extensions.

## Performance

SheetView is canvas-based and viewport-driven. It refreshes visible workbook
data through `attach()`, invalidates rendering for data, geometry, scroll,
zoom, and resize changes, and exposes repaint controls through `view.render`,
including full invalidation, cell invalidation, geometry invalidation, and
single-frame requests.

## Lifecycle

Use `attach()` once per view, `start()` to begin rendering, `switchSheet()` for
active sheet changes, `suspend()` and `resume()` for backgrounding, `resize()`
for explicit sizing, and `dispose()` to release view-owned resources.
Disposing the view does not dispose the attached workbook.

## Related Docs

- [Embed: Web Component](embed-web-component.md) — higher-level component with full UI
- [Embed: React](embed-react.md) — React wrapper
- [Architecture Overview](architecture-overview.md) — where SheetView sits in the layer stack
- [API Reference](../reference/README.md)
