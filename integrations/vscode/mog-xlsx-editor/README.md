# Mog Spreadsheet

Open `.xlsx` workbooks directly in VS Code and Cursor with Mog's spreadsheet
runtime.

Mog brings a full spreadsheet experience into the editor: workbook loading,
grid editing, formula recalculation, formatting, sheet navigation, and XLSX
save/export through the same engine used by Mog's browser spreadsheet app.

## Features

- Opens `.xlsx` files as a VS Code custom editor.
- Lets you inspect and edit workbook data without leaving your code workspace.
- Saves workbook changes back to XLSX.
- Uses Mog's Rust-backed compute engine and web spreadsheet UI.

## Usage

Open an `.xlsx` file and choose **Mog Spreadsheet** when VS Code asks which
editor to use. To make it the default, use **Reopen Editor With...** and select
**Mog Spreadsheet**.
