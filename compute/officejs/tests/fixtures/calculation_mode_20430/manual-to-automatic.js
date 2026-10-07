// Native diagnostic only: valid formula; no forced calculate or mode restoration.
console.log(JSON.stringify({stage:"environment",supports18:Office.context.requirements.isSetSupported("ExcelApi","1.8"),enumAutomatic:Excel.CalculationMode.automatic,enumManual:Excel.CalculationMode.manual,diagnostics:Office.context.diagnostics}));
await Excel.run(async c=>{
 const a=c.application;const r=c.workbook.worksheets.getItem("Sheet1").getRange("A1:A2");
 a.load("calculationMode");r.load("values");await c.sync();
 console.log(JSON.stringify({stage:"before",mode:a.calculationMode,values:r.values}));
 a.calculationMode=Excel.CalculationMode.automatic;
 a.load("calculationMode");await c.sync();
 console.log(JSON.stringify({stage:"same_sync_after_set",mode:a.calculationMode}));
 a.load("calculationMode");await c.sync();
 console.log(JSON.stringify({stage:"fresh_sync",mode:a.calculationMode}));
});
await Excel.run(async c=>{
 const a=c.application;const s=c.workbook.worksheets.getItem("Sheet1");
 a.load("calculationMode");await c.sync();
 console.log(JSON.stringify({stage:"fresh_run_proxy",mode:a.calculationMode}));
 s.getRange("A1").values=[[7]];
 const r=s.getRange("A1:A2");r.load("values");a.load("calculationMode");await c.sync();
 console.log(JSON.stringify({stage:"after_precedent_edit",mode:a.calculationMode,values:r.values}));
});
