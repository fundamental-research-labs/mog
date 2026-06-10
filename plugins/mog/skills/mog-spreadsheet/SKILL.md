---
name: mog-spreadsheet
description: Open, inspect, edit, and export Mog spreadsheet workbooks from Codex through the bundled Mog MCP server and the Codex in-app browser.
---

# Mog Spreadsheet

Use the bundled Mog MCP server for spreadsheet work. Start or find a browser session before using workbook tools, then keep operations targeted at that session.

## Workflow

1. Use `mog_browser_start` to create a blank workbook or open an explicit local `.xlsx` path.
2. Open the returned localhost URL in the Codex in-app browser. If Browser Use is enabled, use it for the visual open/verification step; otherwise present the URL for the user to open in the browser pane.
3. Wait for `mog_browser_status` to report `ready: true` before reading or writing workbook data.
4. Use `mog_cell_read`, `mog_cell_write`, and `mog_selection_set` for deterministic operations on the workbook visible in the browser.
5. Use `mog_export_xlsx` with an explicit output path when the user wants saved workbook bytes.
6. Use Browser Use only for visual verification or UI-only workflows. Do not assume browser-local file access, browser storage, existing cookies, extensions, or a normal browser profile.

The browser-visible workbook is authoritative for browser sessions. Do not present a headless/offline workbook as the same live workbook unless a tool explicitly labels it as headless and separate.
