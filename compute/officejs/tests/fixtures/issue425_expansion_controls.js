await Excel.run(async c => {
  const results=[];
  for (const spec of [
    {name:'FullRow',address:'B4:C4',values:[['B',20]]},
    {name:'Partial',address:'C4',values:[[20]]},
    {name:'Gap',address:'B5:C5',values:[['B',20]]},
    {name:'Outside',address:'D4',values:[[20]]},
    {name:'Totals',address:'B5:C5',values:[['B',20]],totals:true},
    {name:'TwoRows',address:'B4:C5',values:[['B',20],['C',30]]},
    {name:'Clear',address:'B4:C4',values:[['','']]},
    {name:'Null',address:'B4:C4',values:[[null,null]]}
  ]) {
    const s=c.workbook.worksheets.add(spec.name);
    s.getRange('B2:C3').values=[['Item','Sales'],['A',10]];
    const t=s.tables.add('B2:C3',true); t.name='Data'+spec.name;
    if(spec.totals)t.showTotals=true;
    await c.sync();
    s.getRange('E1').formulas=[['=SUM(Data'+spec.name+'[Sales])']];
    s.getRange(spec.address).values=spec.values;
    await c.sync();
    const extent=t.getRange(), sum=s.getRange('E1');
    extent.load('address'); sum.load('values'); await c.sync();
    results.push({name:spec.name,address:extent.address,sum:sum.values});
  }
  console.log(JSON.stringify(results));
});
