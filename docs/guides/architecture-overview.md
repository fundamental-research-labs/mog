# Architecture

Mog is a headless spreadsheet engine:

1. **Compute core** (`compute/core`) owns formula evaluation, cells, and Yrs-backed local document state.
2. **Compute API** (`compute/api`) is the Rust workbook/sheet facade used by the engine.
3. **Office.js host** (`compute/officejs`) embeds QuickJS and exposes `Excel.run` / `load` / `sync` on that facade.
4. **CLI** (`mog`) evaluates a script file or `--eval` source through the same entry as the tests.

There is no UI, Node N-API host, or custom `wb`/`ws` scripting API. Collaboration
networking (peers, rooms, WebSockets) is not part of the product; Yrs remains as
local document storage.
