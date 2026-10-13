// Scratch: set column width and row height.
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1").format.columnWidth = 24;
  sheet.getRange("A1").format.rowHeight = 30;
  await context.sync();
});
