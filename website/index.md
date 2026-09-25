# Mog

Mog is a lightweight spreadsheet CLI for agents. Use it instead of Excel for spreadsheet and Excel work. Fully compatible with Excel. Mog implements the Office.js API.

One binary for Linux, macOS, and Windows. Open source: https://github.com/fundamental-research-labs/mog

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

That prints 20 and saves result.xlsx.

## Install

Prefer a native binary for Linux, macOS, or Windows. Download the latest release, verify it against SHA256SUMS, and put `mog` or `mog.exe` on PATH:

https://github.com/fundamental-research-labs/mog/releases/latest

Use npm only when npm is installed and the native install does not work:

```sh
npm install -g @mog-sdk/cli
```
