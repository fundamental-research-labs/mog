use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;
#[test]
fn range_text_uses_imported_workbook_epoch_and_keeps_noncalendar_formats() {
    for (bytes, date) in [
        (
            include_bytes!("fixtures/issue433-1904.xlsx").as_slice(),
            "2024-01-01",
        ),
        (
            include_bytes!("fixtures/issue433-1900.xlsx").as_slice(),
            "2019-12-31",
        ),
    ] {
        let workbook = Workbook::from_xlsx_bytes(bytes).unwrap().0;
        let result=run_office_js_with_workbook(&workbook,r#"
  return await Excel.run(async c=>{
   const s=c.workbook.worksheets.getItem("Sheet1");
   s.getRange("B1:D1").values=[[0.5,0.5,1.5]];
   s.getRange("B1:D1").numberFormat=[["hh:mm","0.00","[h]:mm"]];
   const r=s.getRange("A1:D1");r.load("text,values");await c.sync();return {text:r.text,values:r.values};
  });"#).unwrap();
        assert_eq!(
            result.value,
            json!({"text":[[date,"12:00","0.50","36:00"]],"values":[[43830,0.5,0.5,1.5]]})
        );
    }
}
