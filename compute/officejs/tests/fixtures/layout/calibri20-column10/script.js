await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 const r=s.getRange("A1");r.format.load(["columnWidth","rowHeight"]);r.format.font.load(["name","size"]);
 s.getRange("A1:B4").values=[["Category","Sales"],["A",15],["B",20],["C",10]];
 const ch=s.charts.add("ColumnClustered",s.getRange("A1:B4"),"Columns");
 ch.setPosition("D2","L18");ch.load(["left","top","width","height"]);await c.sync();
 console.log(JSON.stringify({font:r.format.font.name,fontSize:r.format.font.size,columnWidth:r.format.columnWidth,rowHeight:r.format.rowHeight,chart:[ch.left,ch.top,ch.width,ch.height]}));
});
