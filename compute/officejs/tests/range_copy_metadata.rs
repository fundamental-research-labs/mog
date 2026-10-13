use compute_api::Workbook;
use mog::run_office_js_with_workbook;
fn xml(workbook: &Workbook) -> String {
    let bytes = workbook.to_xlsx_bytes().unwrap();
    let zip = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
    String::from_utf8(zip.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap()
}
#[test]
fn all_copy_transfers_imported_metadata_and_undo_restores_destination() {
    let (workbook, _) =
        Workbook::from_xlsx_bytes(include_bytes!("fixtures/issue436.xlsx")).unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
      await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("D1").copyFrom(s.getRange("A1"),"All"); await c.sync();
      });
    "#,
    )
    .unwrap();
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    assert_eq!(sheet.comments().get_at(0, 0).unwrap().len(), 1);
    let copied = sheet.comments().get_at(0, 3).unwrap();
    assert_eq!(copied.len(), 1);
    assert_eq!(copied[0].content.as_deref(), Some("Synthetic note"));
    let output = xml(&workbook);
    assert!(output.contains("<hyperlink ref=\"D1\""), "{output}");
    assert!(
        output.contains("<conditionalFormatting sqref=\"D1\""),
        "{output}"
    );
    assert!(output.contains("sqref=\"D1:D1\""), "{output}");
    workbook.history().undo().unwrap();
    assert_eq!(sheet.comments().get_at(0, 3).unwrap().len(), 0);
    assert_eq!(sheet.comments().get_at(0, 0).unwrap().len(), 1);
    assert!(!xml(&workbook).contains("sqref=\"D1:D1\""));
    workbook.history().redo().unwrap();
    assert_eq!(sheet.comments().get_at(0, 3).unwrap().len(), 1);
}

#[test]
fn overlapping_copy_uses_frozen_metadata_and_skip_blanks_preserves_destination() {
    for skip in [false, true] {
        let (workbook, _) =
            Workbook::from_xlsx_bytes(include_bytes!("fixtures/copy_metadata_controls.xlsx"))
                .unwrap();
        run_office_js_with_workbook(
            &workbook,
            &format!(
                r#"
          await Excel.run(async c=>{{
            const s=c.workbook.worksheets.getItem("Sheet1");
            if ({skip}) s.getRange("B1").clear("Contents");
            await c.sync();
            s.getRange("B1:C1").copyFrom(s.getRange("A1:B1"),"All",{skip});
            await c.sync();
          }});
        "#
            ),
        )
        .unwrap();
        let s = workbook.sheet_by_name("Sheet1").unwrap();
        assert_eq!(
            s.comments().get_at(0, 0).unwrap()[0].content.as_deref(),
            Some("first")
        );
        assert_eq!(
            s.comments().get_at(0, 1).unwrap()[0].content.as_deref(),
            Some("first")
        );
        assert_eq!(
            s.comments().get_at(0, 2).unwrap()[0].content.as_deref(),
            Some(if skip { "third" } else { "second" })
        );
        let output = xml(&workbook);
        assert!(
            output.split("<conditionalFormatting ").any(|p| p
                .split('>')
                .next()
                .unwrap()
                .contains("A2:C3")),
            "CF outside coverage: {output}"
        );
        assert!(
            output.split("<dataValidation ").any(|p| p
                .split('>')
                .next()
                .unwrap()
                .contains("A2:C3")),
            "validation outside coverage: {output}"
        );
    }
}

#[test]
fn values_only_keeps_destination_metadata_and_all_tiles_copy_notes() {
    let (workbook, _) =
        Workbook::from_xlsx_bytes(include_bytes!("fixtures/copy_metadata_controls.xlsx")).unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
      await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("B1").copyFrom(s.getRange("A1"),"Values");
        s.getRange("E1:F2").copyFrom(s.getRange("A1"),"All");
        await c.sync();
      });
    "#,
    )
    .unwrap();
    let s = workbook.sheet_by_name("Sheet1").unwrap();
    assert_eq!(
        s.comments().get_at(0, 1).unwrap()[0].content.as_deref(),
        Some("second")
    );
    for (r, c) in [(0, 4), (0, 5), (1, 4), (1, 5)] {
        assert_eq!(
            s.comments().get_at(r, c).unwrap()[0].content.as_deref(),
            Some("first")
        );
    }
}

#[test]
fn partial_source_rebases_cf_and_validation_relative_but_not_absolute_refs() {
    let (workbook, _) =
        Workbook::from_xlsx_bytes(include_bytes!("fixtures/copy_metadata_controls.xlsx")).unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
      await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("E4").copyFrom(s.getRange("B2"),"All"); await c.sync();
      });
    "#,
    )
    .unwrap();
    let output = xml(&workbook);
    for (element, dest) in [("conditionalFormatting", "E4"), ("dataValidation", "E4:E4")] {
        let find = |range: &str| {
            output
                .split(&format!("<{element} "))
                .find(|p| {
                    p.split('>')
                        .next()
                        .unwrap()
                        .contains(&format!("sqref=\"{range}\""))
                })
                .unwrap()
                .split(&format!("</{element}>"))
                .next()
                .unwrap()
                .to_string()
        };
        let copied = find(dest);
        let original = find("A1:C3");
        assert!(
            copied.contains("AND(E4&gt;0,$C$3=10)"),
            "{element}: {copied}"
        );
        assert!(
            original.contains("AND(A1&gt;0,$C$3=10)"),
            "{element}: {original}"
        );
    }
}
