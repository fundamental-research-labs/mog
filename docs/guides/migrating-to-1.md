# Migrating to Mog 1.0

Mog 1.0 replaces the old SDK-based CLI with a standalone Rust executable.
`@mog-sdk/cli` remains the npm distribution name, but now only launches that
executable. It does not depend on `@mog-sdk/sdk`.

## Commands

The CLI uses flags rather than subcommands:

```sh
mog -i input.xlsx -f script.js -o output.xlsx
mog -i input.xlsx -r
mog --help
```

Input files are saved in place unless `-o` selects another destination.
Scripts automatically recalculate before saving. See the
[CLI reference](cli.md) for sessions and error behavior.

## Scripts

Rewrite scripts using `Excel.run(async context => { ... })` and the Office.js
Excel object model. The earlier `wb` / `ws` SDK API is not exposed. There is no
Node module import, browser UI, playground, or WASM runtime in Mog 1.0.

```js
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getItem("Sheet1");
  sheet.getRange("A1").values = [[42]];
  await context.sync();
});
```

Use `load` and `context.sync()` before reading proxy properties. Supported API
coverage is still incomplete; [scripting support](officejs.md) describes the
contract. A major version marks the native CLI release, not full Excel parity.

Earlier SDK, UI, and browser packages are not part of this release. Existing
users of those packages should keep their pinned versions until they have
adapted their workflows to the native CLI.
