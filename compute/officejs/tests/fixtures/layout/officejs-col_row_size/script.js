// officejs: column width and row height.
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1").values = [["sized"]];
  sheet.getRange("A1").format.columnWidth = 28;
  sheet.getRange("A1").format.rowHeight = 22;
  sheet.getRange("B1").format.columnWidth = 12;
  await context.sync();
});
