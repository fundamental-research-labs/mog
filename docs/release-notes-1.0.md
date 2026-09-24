Mog 1.0 is a native spreadsheet CLI with the Office.js Excel API as its primary
scripting interface. Open, edit, recalculate, and save XLSX files without Excel,
a browser, or a server.

- A standalone Rust executable with embedded QuickJS.
- Office.js scripts using `Excel.run`, `context.workbook`, `load`, and `sync`.
- File-based and inline scripts, explicit recalculation, and persistent sessions.
- Native downloads for macOS (Apple Silicon/Intel), Linux (ARM64/x64, glibc),
  and Windows x64, with SHA-256 checksums.
- `@mog-sdk/cli` as a thin npm launcher for the same native executable.

This replaces the earlier SDK-based CLI. Commands now use flags, and scripts
use Office.js instead of the former `wb`/`ws` interface. UI, browser/WASM, and
SDK packages are not part of this release. Office.js coverage remains
incomplete; 1.0 does not imply full Excel compatibility.

See [installation](https://github.com/fundamental-research-labs/mog/blob/main/docs/guides/installation.md),
[migration](https://github.com/fundamental-research-labs/mog/blob/main/docs/guides/migrating-to-1.md),
and [API support](https://github.com/fundamental-research-labs/mog/blob/main/docs/guides/officejs.md).
