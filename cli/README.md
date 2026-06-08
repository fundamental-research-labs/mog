# Mog CLI

Command-line interface for operating Mog workbooks with the headless SDK.

```bash
npm install --prefix "$HOME/.mog/npm" @mog-sdk/cli
export PATH="$HOME/.mog/npm/node_modules/.bin:$PATH"
mog --help
```

The `mog` command creates or loads workbook handles in a local daemon, executes
code against the public `@mog-sdk/sdk` workbook API, commits changes to `.xlsx`,
and unloads handles when work is complete.
