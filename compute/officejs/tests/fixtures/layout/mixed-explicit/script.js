await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("A1:L18").format.columnWidth=48;
 s.getRange("A1:B4").values=[["Category","Sales"],["A",15],["B",20],["C",10]];
 const ch=s.charts.add("ColumnClustered",s.getRange("A1:B4"),"Columns");ch.name="MixedGeometry";
 ch.setPosition("D2","L18");ch.load(["left","top","width","height"]);await c.sync();
 console.log("position="+JSON.stringify([ch.left,ch.top,ch.width,ch.height]));
 ch.width=480;ch.load(["left","top","width","height"]);await c.sync();
 console.log("width="+JSON.stringify([ch.left,ch.top,ch.width,ch.height]));
 ch.top=20;ch.load(["left","top","width","height"]);await c.sync();
 console.log("top="+JSON.stringify([ch.left,ch.top,ch.width,ch.height]));
});
