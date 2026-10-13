await Excel.run(async c=>{
 const s=c.workbook.worksheets.getItem("Sheet1");
 s.getRange("A1:B4").values=[["Category","Sales"],["A",15],["B",20],["C",10]];
 const chart=s.charts.add("ColumnClustered",s.getRange("A1:B4"),"Columns");
 chart.name="SyntheticSales";chart.title.text="Quarterly sales";chart.title.visible=true;
 chart.axes.categoryAxis.title.text="Category";chart.axes.categoryAxis.title.visible=true;
 chart.axes.valueAxis.title.text="Revenue";chart.axes.valueAxis.title.visible=true;
 chart.legend.visible=true;chart.legend.position="Bottom";
 chart.setPosition("D2","L18");await c.sync();
});
