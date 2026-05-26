# App API

> **Status: Forward-looking / No active consumers**
>
> This module is infrastructure for a future third-party app platform. Currently, no apps use it —
> the spreadsheet app (`apps/spreadsheet/`) uses the unified kernel API (`../api/`) directly
> as trusted OS-level code. The only wiring exists in the shell (`shell/`) for gating
> hypothetical external apps.
>
> Consider this module a candidate for removal or rebuild when the app platform is actually needed.

## Purpose

Provides a **database-like API** (tables, records, columns, relations) over the spreadsheet kernel,
with capability-based permission gating for sandboxed third-party apps.

## Architecture

```
OS App (sandboxed, untrusted)
  ↓
capability-gated/ (apps receive undefined for denied capabilities, never errors)
  ↓
AppKernelAPI (translates RecordId ↔ RowId, AppColumnId ↔ ColId)
  ↓
Unified Kernel API (../api/) + Domain modules (../domain/)
```

## Modules

- **`app-kernel-api.ts`** — Core implementation: tables, columns, records, relations, events, clipboard, undo
- **`bindings-api.ts`** — App instance binding management (table ↔ app mappings)
- **`capability-gated/`** — Permission enforcement layer with scoped sub-APIs
