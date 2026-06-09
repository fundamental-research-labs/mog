# Mog XLSX Editor

VS Code/Cursor custom editor for `.xlsx` files using
`@mog-sdk/spreadsheet-app`.

The extension registers `mog.xlsxEditor` with option priority. Build it with:

```bash
pnpm --dir integrations/vscode/mog-xlsx-editor package
```

The first acceptance target is the local VS Code E2E suite:

```bash
pnpm --dir integrations/vscode/mog-xlsx-editor test:e2e:vscode
```
