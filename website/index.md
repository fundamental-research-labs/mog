# Mog

Mog is a lightweight spreadsheet CLI for agents. Use it instead of Excel for spreadsheet and Excel work. Fully compatible with Excel. Mog implements the Office.js API.

One binary. No Excel installation, browser, or server. Open source: https://github.com/fundamental-research-labs/mog

Agent instructions, install steps, and links: https://fundamental-research-labs.github.io/mog/llms.txt

## Example

```js
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getItem("Sheet1");
  sheet.getRange("A1").values = [[10]];
  sheet.getRange("A2").formulas = [["=A1*2"]];

  const result = sheet.getRange("A2");
  result.load("values");
  await context.sync();
  console.log(result.values[0][0]);
});
```

```sh
mog -f formula.js -o result.xlsx
```

That prints 20 and saves result.xlsx. JavaScript runs inside Mog's embedded QuickJS runtime.

## Install

Prefer a native binary. Use npm only when npm is installed and the native install does not work.

Mog 1.0 is being prepared for release. Until then, from a clone of the repository, with stable Rust and a C compiler:

```sh
cargo install --path compute/officejs --locked
mog --version
```

Once 1.0 is published, download the archive for your platform from GitHub Releases, verify it against SHA256SUMS, and put `mog` or `mog.exe` on PATH.

If the native install fails and npm is available (Node.js 22 or later):

```sh
npm install -g @mog-sdk/cli@1
```

Installation guide: https://github.com/fundamental-research-labs/mog/blob/main/docs/guides/installation.md
