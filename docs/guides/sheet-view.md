# SheetView

> **Status: skeleton — content pending package stabilization**

Use `@mog-sdk/sheet-view` to render a spreadsheet grid inside your own application chrome. SheetView is the lower-level rendering layer that `@mog-sdk/embed` builds on top of.

## Prerequisites

- Browser environment with Canvas API support
- `@mog-sdk/sheet-view` and `@mog-sdk/kernel` packages
- A Workbook instance to bind to

## Install

```bash
# example: npm install @mog-sdk/sheet-view @mog-sdk/kernel
```

## When to Use SheetView vs. Embed

SheetView gives you a grid renderer with no surrounding UI (no toolbar, no formula bar, no sheet tabs). Use it when you want full control over the application shell. Use `@mog-sdk/embed` for packaged sheet/view embeds. Use `@mog-sdk/spreadsheet-app` when you need the full spreadsheet app with ribbon, formula bar, sheet tabs, and app chrome.

## Mount

Create a SheetView instance and mount it to a DOM container element.

```typescript
// example: new SheetView({ container, workbook })
```

## Bind to a Workbook

Connect the view to a Workbook instance. The view observes the workbook's CRDT state and re-renders on changes.

```typescript
// example: view.bind(workbook)
```

## Handle User Input

SheetView handles keyboard and mouse input for cell selection, editing, and navigation. How to intercept or extend input handling.

## Handle Events

Events emitted by SheetView: cell edit, selection change, context menu request, scroll position change. How to subscribe.

```typescript
// example: view.on('selectionChange', handler)
```

## Customization

Cell renderers, column/row sizing, frozen panes, conditional formatting hooks. What is customizable vs. what requires forking.

## Performance

Virtualization model (only visible cells are rendered). Canvas rendering pipeline. What affects frame rate.

## Lifecycle

Mount, update, unmount. Cleanup and memory management.

## Related Docs

- [Embed: Web Component](embed-web-component.md) — higher-level component with full UI
- [Embed: React](embed-react.md) — React wrapper
- [Architecture Overview](architecture-overview.md) — where SheetView sits in the layer stack
- [API Reference](../reference/README.md)
