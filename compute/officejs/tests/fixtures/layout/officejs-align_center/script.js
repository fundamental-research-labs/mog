// officejs: horizontal and vertical alignment.
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1").values = [["ctr"]];
  sheet.getRange("A1").format.horizontalAlignment = Excel.HorizontalAlignment.center;
  sheet.getRange("A1").format.verticalAlignment = Excel.VerticalAlignment.center;
  sheet.getRange("A1").format.rowHeight = 24;
  sheet.getRange("A1").format.columnWidth = 16;
  await context.sync();
});
