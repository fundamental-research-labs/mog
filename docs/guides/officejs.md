# Office.js scripting

The engine implements a growing portion of the Office.js Excel
application-specific API:

- `Excel.run` with a `RequestContext`
- Proxy objects that queue work until `await context.sync()`
- `load(...)` with string, array, and nested property projections
- `context.workbook.worksheets.getItem` / `add` / `getActiveWorksheet`
- `worksheet.getRange`
- `Range.values` (2-D get/set)
- `Range.formulas` writes, with computed values readable after `load` + `sync`
- Range addresses, dimensions, and row/column indices
- Range formatting through `format`, `font`, `fill`, and `protection`
- Worksheet table creation, name/ID lookup, scalar properties, and table ranges
- 50 `workbook.functions` methods with loadable `FunctionResult.value` / `error`
  (see [supported functions and verification cases](../../compute/officejs/FUNCTIONS.md))

Additional supported operations include named items, filters and sorting,
conditional formatting, validation, comments, and selected pivot operations.
See [verification](verification.md) for coverage checks. Availability of an
object does not imply support for all its members.

Fresh proxy properties require `load` and `sync` before reading. Assigning a
writable property also caches that value on the same proxy; use a fresh proxy
with `load` and `sync` to read the engine's resulting state. A `null` cell in
a values write preserves the existing cell, while an empty string clears it.

Callers and scripts have full access to the workbook they receive. Applications
embedding Mog are responsible for authorizing workbook access; the compute
engine does not enforce caller-specific workbook, sheet, or cell permissions.
Excel sheet protection remains a separate document feature.

The target contract is Microsoft's Excel JavaScript API. Implementation and
behavioral coverage are incomplete; the listed features do not establish
support for an entire Excel API requirement set. Charts and many other Excel
members remain unimplemented. Some pivot operations are available; this is not
complete pivot API support. Word, PowerPoint, and Office dialogs are outside
this spreadsheet engine's scope.

Each mutating `context.sync()` is one native undo action. Rust callers use
`workbook.history().undo()` / `redo()` and can group multiple operations with
`begin_undo_group()` / `end_undo_group()`. See [undo and redo](undo-redo.md)
for grouping, error handling, and redo behavior.

## Comparing with Excel

Random, clock, path, and platform-dependent results require controlled inputs
or separate assertions, including dependent cells and spill ranges, when
comparing against an Excel-generated workbook. Exact cached-value equality
does not verify calculation accuracy.
