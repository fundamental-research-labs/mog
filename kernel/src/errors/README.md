# Errors — Unified Error System

Machine-readable error codes, type-safe error hierarchy, and result types
for the kernel. Errors are never thrown from domain code — they are returned
via `OperationResult<T>`.

```
  api/ domain/ bridges/ impl/
    |     |       |       |
    v     v       v       v
  ┌──────────────────────────────────┐
  │           errors/                │
  │                                  │
  │  KernelError (base class)        │
  │    code:       KernelErrorCode   │
  │    message:    string            │
  │    context:    Record<string,?>  │
  │    suggestion: string?           │
  │    path:       string[]?         │
  │    cause:      KernelError?      │
  │                                  │
  │  OperationResult<T>              │
  │    { success: true,  data: T }   │
  │    { success: false, error }     │
  └──────────────────────────────────┘
        Leaf module — zero kernel imports
```

## Directory

| File                 | Purpose |
|----------------------|---------|
| `kernel-error.ts`    | `KernelError` base class — code-based construction, `from()` for wrapping unknown errors, `toJSON()`/`fromJSON()` for IPC serialization, recursive cause chains. |
| `codes.ts`           | `KernelErrorCode` union type — ~90 machine-readable codes organized by domain prefix. |
| `operation.ts`       | `OperationResult<T>` discriminated union + helpers: `okResult()`, `failResult()`, `unwrap()`, `mapResult()`. |
| `api.ts`             | Factory functions for API/validation errors (cell address, range, sheet, formula, object). |
| `bridge.ts`          | `BridgeError` subclass — transport, WASM load, lifecycle, mutation rejection. |
| `capability.ts`      | `CapabilityError` subclass — denied, scope mismatch, expired, auth required. |
| `document.ts`        | Document lifecycle subclasses — `DocumentNotReadyError`, `DocumentDisposedError`, `HydrationError`, `EngineCreateError`. |
| `floating-object.ts` | `FloatingObjectError` subclass — chart/shape/drawing/equation not found or invalid config. |
| `index.ts`           | Barrel re-exports + `toApiError()` converter for IPC boundaries. |

## Error Code Domains

Each domain owns its prefix exclusively. No two domains share a namespace.

| Prefix       | Domain                      | Example codes |
|--------------|-----------------------------|---------------|
| `API_*`      | API validation              | `API_INVALID_CELL_ADDRESS`, `API_SHEET_NOT_FOUND` |
| `FORMULA_*`  | Formula engine              | `FORMULA_PARSE_ERROR`, `FORMULA_CIRCULAR_REFERENCE` |
| `TABLE_*`    | Table operations            | `TABLE_NOT_FOUND`, `TABLE_INVALID_RESIZE` |
| `EXEC_*`     | Code execution              | `EXEC_CANCELLED`, `EXEC_UNKNOWN_METHOD` |
| `OBJ_*`      | Floating objects            | `OBJ_CHART_NOT_FOUND`, `OBJ_SHAPE_INVALID_CONFIG` |
| `BRIDGE_*`   | Transport / IPC             | `BRIDGE_NOT_AVAILABLE`, `BRIDGE_WASM_LOAD_FAILED` |
| `CAP_*`      | Capabilities / auth         | `CAP_DENIED`, `CAP_EXPIRED` |
| `DOC_*`      | Document lifecycle          | `DOC_NOT_READY`, `DOC_DISPOSED` |
| `DOMAIN_*`   | Domain-specific operations  | `DOMAIN_FILTER_CREATE_FAILED` |
| `COMMENT_*`  | Comments                    | `COMMENT_NOT_FOUND` |
| `CONDITIONAL_FORMAT_*` | Conditional formatting | `CONDITIONAL_FORMAT_NOT_FOUND` |
| `VALIDATION_*` | Data validation           | `VALIDATION_NOT_FOUND` |
| `FILTER_*`   | Worksheet filters           | `FILTER_NOT_FOUND` |
| `FORM_CONTROL_*` | Form controls           | `FORM_CONTROL_NOT_FOUND` |
| `SPARKLINE_*` | Sparklines                 | `SPARKLINE_NOT_FOUND` |
| `HYPERLINK_*` | Hyperlinks                 | `HYPERLINK_NOT_FOUND` |
| `FS_*`       | Filesystem                  | `FS_INVALID_PATH` |
| `REGISTRY_*` | Driver registry             | `REGISTRY_DRIVER_NOT_FOUND` |
| `COMPUTE_*`  | Compute-core                | `COMPUTE_ERROR` |

## Key Design Decisions

1. **Errors are values, not exceptions.** Domain code returns `OperationResult<T>` — callers pattern-match on `success`. Only `unwrap()` throws.
2. **One code per error type.** Every `KernelError` carries a `KernelErrorCode` from the union. Consumers can switch on the code for programmatic handling.
3. **Structured context, not string parsing.** Each error carries a typed `context` record, optional `path` (parameter trail), and optional `suggestion`.
4. **IPC-safe.** `toJSON()` / `fromJSON()` round-trip the full error including recursive cause chains. `toApiError()` converts to the contracts `ApiError` shape for crossing IPC boundaries.
5. **Leaf module.** This directory does not import from any other kernel folder — only from `@mog-sdk/contracts` types. Any kernel module can depend on `errors/` without risk of cycles.

## Consumers

- **`api/`** — wraps domain results, converts to `ApiError` at the public boundary
- **`domain/`** — returns `OperationResult<T>` from every fallible operation
- **`bridges/`** — `BridgeError` for transport failures, `from()` to wrap native errors
- **`impl/`** — workbook-impl, worksheet-impl use factory functions from `api.ts`
- **`services/`** — capability checks via `CapabilityError`
