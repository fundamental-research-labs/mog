# compute-core-napi

Native Node.js addon for the Rust compute-core engine via napi-rs.

## Build Prerequisites

- **Rust**: stable 1.93+ (edition 2024)
- **napi-cli**: `npm i -g @napi-rs/cli`
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `build-essential`, `pkg-config`

## Build

```bash
# Fast local build (default; used by api-eval)
pnpm build

# Full release build (publishing/packaging)
pnpm build:release

# Debug build (faster compile, slower runtime)
pnpm build:debug
```

Produces `compute-core-napi.node` in this directory and syncs it into the
current host platform package under `npm/<platform>/`, which is what the Node
SDK loads at runtime.

## Smoke Test

```bash
node smoke-test.mjs
```

## Usage

```javascript
const addon = require('./compute-core-napi.node');

// Static functions
addon.computeSetCurrentTime(45292.0);

// Class-based engine
const engine = new addon.ComputeEngine(JSON.stringify({
  sheets: [{
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Sheet1',
    rows: 100,
    cols: 26,
    cells: [],
  }],
}));

// Instance methods (snake_case matching the TS bridge client)
const initResult = engine.compute_take_init_result();
engine.compute_set_cell(
  JSON.stringify(sheetId),   // [serde] SheetId
  JSON.stringify(cellId),    // [serde] CellId
  0,                         // [prim]  row
  0,                         // [prim]  col
  '=A1+A2'                   // [str]   input
);
```

## Parameter Conventions

| Bridge Tag | JS Type | Example |
|------------|---------|---------|
| `[str]`    | string  | `'hello'` |
| `[prim]`   | number/boolean | `42` |
| `[parse]`  | string (UUID) | `'00000000-...'` |
| `[serde]`  | JSON string | `JSON.stringify(value)` |
| `[bytes]`  | Buffer  | `Buffer.from(...)` |

Note: SheetId and CellId are `[serde]`-tagged (not `[parse]`), so they require `JSON.stringify(uuid)`.
