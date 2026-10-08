// officejs: wrap a long text cell.
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1").values = [["a long string that should wrap onto more than one line"]];
  sheet.getRange("A1").format.wrapText = true;
  sheet.getRange("A1").format.columnWidth = 18;
  sheet.getRange("A1").format.rowHeight = 36;
  await context.sync();
});
