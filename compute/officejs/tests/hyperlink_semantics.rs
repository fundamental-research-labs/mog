//! Fresh Range hyperlink reads through the shipped Office.js runtime.

use compute_api::Workbook;
use mog::run_office_js_with_workbook;
use serde_json::json;

#[test]
fn fresh_range_loads_hyperlink_after_write() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async c => {
          const s = c.workbook.worksheets.getItem("Sheet1");
          s.getRange("A1").hyperlink = {address:"https://example.com",textToDisplay:"Link"};
          await c.sync();
          const fresh = s.getRange("A1");
          fresh.load("hyperlink");
          await c.sync();
          return {address: fresh.hyperlink.address, text: fresh.hyperlink.textToDisplay};
        });
        "#,
    )
    .expect("fresh Range hyperlink load");
    assert_eq!(
        output.value,
        json!({"address":"https://example.com/","text":"Link"})
    );
}

#[test]
fn hyperlink_load_reads_native_store_at_range_coordinates() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    let sheet = workbook.sheet_by_name("Sheet1").expect("sheet");
    sheet
        .hyperlinks()
        .set(2, 1, "https://example.com/native")
        .expect("native hyperlink");
    let output = run_office_js_with_workbook(
        &workbook,
        r#"
        return await Excel.run(async c => {
          const range = c.workbook.worksheets.getItem("Sheet1").getRange("B3");
          let unloaded = false;
          try { range.hyperlink; } catch (e) { unloaded = e.code === "PropertyNotLoaded"; }
          range.load("hyperlink");
          await c.sync();
          return {unloaded, address: range.hyperlink.address};
        });
        "#,
    )
    .expect("native hyperlink load");
    assert_eq!(
        output.value,
        json!({"unloaded":true,"address":"https://example.com/native"})
    );
}

#[test]
fn web_hyperlinks_supply_only_an_empty_path() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    let cases = [
        ("https://example.com", "https://example.com/"),
        ("http://example.com:8080", "http://example.com:8080/"),
        ("HTTPS://Example.com", "HTTPS://Example.com/"),
        ("https://example.com?x=1", "https://example.com/?x=1"),
        ("https://example.com#part", "https://example.com/#part"),
        (
            "https://example.com?x=1#part",
            "https://example.com/?x=1#part",
        ),
        ("https://example.com/", "https://example.com/"),
        (
            "https://example.com/path?x=1#part",
            "https://example.com/path?x=1#part",
        ),
        ("https://example.com/a%2Fb", "https://example.com/a%2Fb"),
        ("https://[::1]:8080?x=1", "https://[::1]:8080/?x=1"),
        ("mailto:person@example.com", "mailto:person@example.com"),
        ("ftp://example.com", "ftp://example.com"),
        ("file:///tmp/book.xlsx", "file:///tmp/book.xlsx"),
        ("../book.xlsx#Sheet1!A1", "../book.xlsx#Sheet1!A1"),
        ("#Sheet1!A1", "#Sheet1!A1"),
        ("https://", "https://"),
        ("https://?x=1", "https://?x=1"),
        (
            "https://user:pass@example.com?x=1",
            "https://user:pass@example.com/?x=1",
        ),
        ("https://user@", "https://user@"),
    ];
    for (address, expected) in cases {
        let script = format!(
            r#"return await Excel.run(async c => {{
              const s = c.workbook.worksheets.getItem("Sheet1");
              s.getRange("A1").hyperlink = {{address: {}, textToDisplay:"Link"}};
              await c.sync();
              const fresh=s.getRange("A1"); fresh.load("hyperlink");
              await c.sync(); return fresh.hyperlink.address;
            }});"#,
            serde_json::to_string(address).unwrap()
        );
        let output = run_office_js_with_workbook(&workbook, &script).expect("load hyperlink");
        assert_eq!(output.value, json!(expected), "fresh load: {address}");
        let stored = workbook
            .sheet_by_name("Sheet1")
            .unwrap()
            .hyperlinks()
            .get(0, 0)
            .unwrap();
        assert_eq!(
            stored.as_deref(),
            Some(expected),
            "stored address: {address}"
        );
    }
}
