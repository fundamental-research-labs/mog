// officejs: wrap a long text cell.
await Excel.run(async (context) => {
  const sheet = context.workbook.worksheets.getActiveWorksheet();
  sheet.getRange("A1").values = [["a long string that should wrap onto more than one line"]];
  sheet.getRange("A1").format.wrapText = true;
  sheet.getRange("A1").format.columnWidth = 18;
  sheet.getRange("A1").format.rowHeight = 36;
  await context.sync();
});

await Excel.run(async c=>{const s=c.workbook.worksheets.getActiveWorksheet();const a=s.getRange('A1'),b=s.getRange('B1');a.format.load(['columnWidth','rowHeight']);b.format.load('columnWidth');await c.sync();console.log(JSON.stringify({aWidth:a.format.columnWidth,aHeight:a.format.rowHeight,bWidth:b.format.columnWidth}));});
