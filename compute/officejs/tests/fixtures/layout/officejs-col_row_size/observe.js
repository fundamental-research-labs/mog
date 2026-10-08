// officejs: column width and row height.
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1").values = [["sized"]];
  sheet.getRange("A1").format.columnWidth = 28;
  sheet.getRange("A1").format.rowHeight = 22;
  sheet.getRange("B1").format.columnWidth = 12;
  await context.sync();
});

await Excel.run(async c=>{const s=c.workbook.worksheets.getActiveWorksheet();const a=s.getRange('A1'),b=s.getRange('B1');a.format.load(['columnWidth','rowHeight']);b.format.load('columnWidth');await c.sync();console.log(JSON.stringify({aWidth:a.format.columnWidth,aHeight:a.format.rowHeight,bWidth:b.format.columnWidth}));});
