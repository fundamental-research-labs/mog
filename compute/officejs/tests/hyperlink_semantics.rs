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
fn web_hyperlinks_keep_address_and_document_reference_distinct() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    let cases = [
        ("https://example.com", "https://example.com/", None),
        ("http://example.com:8080", "http://example.com:8080/", None),
        ("HTTPS://Example.com", "https://example.com/", None),
        ("https://example.com?x=1", "https://example.com/?x=1", None),
        (
            "https://example.com#part",
            "https://example.com/",
            Some("part"),
        ),
        (
            "https://example.com?x=1#part",
            "https://example.com/?x=1",
            Some("part"),
        ),
        ("https://example.com/", "https://example.com/", None),
        (
            "https://example.com/path?x=1#part",
            "https://example.com/path?x=1",
            Some("part"),
        ),
        (
            "https://example.com/a%2Fb",
            "https://example.com/a%2Fb",
            None,
        ),
        (
            "https://example.com/a%23b",
            "https://example.com/a%23b",
            None,
        ),
        ("https://[::1]:8080?x=1", "https://[::1]:8080/?x=1", None),
        (
            "mailto:person@example.com",
            "mailto:person@example.com",
            None,
        ),
        ("ftp://example.com", "ftp://example.com/", None),
        ("file:///tmp/book.xlsx", "file:///tmp/book.xlsx", None),
        ("../book.xlsx#Sheet1!A1", "../book.xlsx#Sheet1!A1", None),
        ("#Sheet1!A1", "#Sheet1!A1", None),
        ("https://", "https://", None),
        ("https://?x=1", "https://?x=1", None),
        (
            "HTTPS://User:Pass@Example.com/Path?Q=X#Part",
            "https://User:Pass@example.com/Path?Q=X",
            Some("Part"),
        ),
        ("https://user@", "https://user@", None),
    ];
    for (address, expected_address, expected_reference) in cases {
        let script = format!(
            r#"return await Excel.run(async c => {{
              const s = c.workbook.worksheets.getItem("Sheet1");
              s.getRange("A1").hyperlink = {{address: {}, textToDisplay:"Link"}};
              await c.sync();
              const fresh=s.getRange("A1"); fresh.load("hyperlink");
              await c.sync(); return {{address:fresh.hyperlink.address, reference:fresh.hyperlink.documentReference}};
            }});"#,
            serde_json::to_string(address).unwrap()
        );
        let output = run_office_js_with_workbook(&workbook, &script).expect("load hyperlink");
        assert_eq!(
            output.value,
            json!({"address":expected_address,"reference":expected_reference}),
            "{address}"
        );
    }
}

#[test]
fn explicit_document_references_follow_observed_excel_precedence() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    // These five inputs and outputs were observed in native Excel.
    let cases = [
        (
            json!({"address":"https://example.com/path","documentReference":"part"}),
            "https://example.com/path",
            Some("part"),
        ),
        (
            json!({"address":"https://example.com/path#old","documentReference":"new"}),
            "https://example.com/path",
            Some("new"),
        ),
        (
            json!({"address":"https://example.com/path#old","documentReference":""}),
            "https://example.com/path",
            Some("old"),
        ),
        (
            json!({"address":"https://example.com/path#"}),
            "https://example.com/path",
            None,
        ),
        (
            json!({"address":"ftp://EXAMPLE.com#part"}),
            "ftp://example.com/",
            Some("part"),
        ),
    ];
    for (mut link, address, reference) in cases {
        link["textToDisplay"] = json!("Link");
        let script = format!(
            r#"return await Excel.run(async c=>{{
          const s=c.workbook.worksheets.getItem("Sheet1");s.getRange("A1").hyperlink={link};await c.sync();
          const r=s.getRange("A1");r.load("hyperlink");await c.sync();
          return {{address:r.hyperlink.address,reference:r.hyperlink.documentReference}};
        }});"#
        );
        let output = run_office_js_with_workbook(&workbook, &script).unwrap();
        assert_eq!(
            output.value,
            json!({"address":address,"reference":reference})
        );
    }
}

#[test]
fn fragment_survives_object_copy_export_and_reimport() {
    let workbook = Workbook::blank().expect("blank workbook").0;
    run_office_js_with_workbook(&workbook,r#"
      await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1").hyperlink={address:"HTTPS://Example.com/Path?Q=X#Part",textToDisplay:"Link"};await c.sync();
        const r=s.getRange("A1");r.load("hyperlink");await c.sync();
        s.getRange("B1").hyperlink=r.hyperlink;await c.sync();
      });
    "#).unwrap();
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    for col in [0, 1] {
        assert_eq!(
            sheet.hyperlinks().get(0, col).unwrap().as_deref(),
            Some("https://example.com/Path?Q=X#Part"),
            "the native string API retains the complete target"
        );
    }
    let bytes = workbook.to_xlsx_bytes().unwrap();
    let zip = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
    let sheet = String::from_utf8(zip.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let rels = String::from_utf8(
        zip.read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(sheet.matches("location=\"Part\"").count(), 2, "{sheet}");
    assert!(
        rels.contains("Target=\"https://example.com/Path?Q=X\""),
        "{rels}"
    );
    assert!(
        !rels.contains("#Part"),
        "fragment must be stored as location: {rels}"
    );
    let (loaded, _) = Workbook::from_xlsx_bytes(&bytes).unwrap();
    let output=run_office_js_with_workbook(&loaded,r#"return await Excel.run(async c=>{
      const r=c.workbook.worksheets.getItem("Sheet1").getRange("B1");r.load("hyperlink");await c.sync();
      return {address:r.hyperlink.address,reference:r.hyperlink.documentReference,text:r.hyperlink.textToDisplay};
    });"#).unwrap();
    assert_eq!(
        output.value,
        json!({"address":"https://example.com/Path?Q=X","reference":"Part","text":"Link"})
    );
}
