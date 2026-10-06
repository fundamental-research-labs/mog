use compute_api::Workbook;
use mog::run_office_js_with_workbook;

fn sheet_xml(workbook: &Workbook) -> String {
    let bytes = workbook.to_xlsx_bytes().unwrap();
    let zip = xlsx_parser::zip::XlsxArchive::new(&bytes).unwrap();
    String::from_utf8(zip.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap()
}

#[test]
fn clear_all_removes_imported_metadata_and_undo_restores_it() {
    let (workbook, _) =
        Workbook::from_xlsx_bytes(include_bytes!("fixtures/issue437.xlsx")).unwrap();
    let original = sheet_xml(&workbook);
    assert!(
        original.contains("dataValidation")
            && original.contains("conditionalFormatting")
            && original.contains("hyperlink")
    );
    run_office_js_with_workbook(
        &workbook,
        r#"
      await Excel.run(async c=>{
        const s=c.workbook.worksheets.getItem("Sheet1");
        s.getRange("A1").clear("All"); await c.sync();
      });
    "#,
    )
    .unwrap();
    let cleared = sheet_xml(&workbook);
    assert!(
        !cleared.contains("<dataValidation ")
            && !cleared.contains("<conditionalFormatting ")
            && !cleared.contains("<hyperlink "),
        "{cleared}"
    );
    assert_eq!(
        workbook
            .sheet_by_name("Sheet1")
            .unwrap()
            .comments()
            .get_all()
            .unwrap()
            .len(),
        0
    );
    workbook.history().undo().unwrap();
    let restored = sheet_xml(&workbook);
    assert!(
        restored.contains("dataValidation")
            && restored.contains("conditionalFormatting")
            && restored.contains("hyperlink")
    );
    assert_eq!(
        workbook
            .sheet_by_name("Sheet1")
            .unwrap()
            .comments()
            .get_all()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn clear_center_preserves_rule_fragments_and_rebases_their_formulas() {
    let (workbook, _) =
        Workbook::from_xlsx_bytes(include_bytes!("fixtures/clear_metadata_partial.xlsx")).unwrap();
    run_office_js_with_workbook(
        &workbook,
        r#"
      await Excel.run(async c=>{
        c.workbook.worksheets.getItem("Sheet1").getRange("B2").clear("All");
        await c.sync();
      });
    "#,
    )
    .unwrap();
    let xml = sheet_xml(&workbook);
    assert!(!xml.contains("sqref=\"A1:C3\""), "{xml}");
    for (range, formula) in [
        ("A1:C1", "A1&gt;0"),
        ("A3:C3", "A3&gt;0"),
        ("A2:A2", "A2&gt;0"),
        ("C2:C2", "C2&gt;0"),
    ] {
        assert!(
            xml.contains(&format!("sqref=\"{range}\"")),
            "missing {range}: {xml}"
        );
        assert!(xml.contains(formula), "missing {formula}: {xml}");
    }
    assert_eq!(
        workbook
            .sheet_by_name("Sheet1")
            .unwrap()
            .comments()
            .get_all()
            .unwrap()
            .len(),
        8
    );
    workbook.history().undo().unwrap();
    assert_eq!(
        workbook
            .sheet_by_name("Sheet1")
            .unwrap()
            .comments()
            .get_all()
            .unwrap()
            .len(),
        9
    );
    assert!(sheet_xml(&workbook).contains("sqref=\"A1:C3\""));
}

#[test]
fn other_clear_modes_preserve_notes_validation_and_conditional_formats() {
    for mode in ["Contents", "Formats", "Hyperlinks"] {
        let (workbook, _) =
            Workbook::from_xlsx_bytes(include_bytes!("fixtures/issue437.xlsx")).unwrap();
        run_office_js_with_workbook(
            &workbook,
            &format!(
                r#"
          await Excel.run(async c=>{{
            c.workbook.worksheets.getItem("Sheet1").getRange("A1").clear("{mode}");
            await c.sync();
          }});
        "#
            ),
        )
        .unwrap();
        let xml = sheet_xml(&workbook);
        assert!(
            xml.contains("<dataValidation ") && xml.contains("<conditionalFormatting "),
            "{mode}: {xml}"
        );
        assert_eq!(
            workbook
                .sheet_by_name("Sheet1")
                .unwrap()
                .comments()
                .get_all()
                .unwrap()
                .len(),
            1,
            "{mode}"
        );
    }
}

#[test]
fn multirange_conditional_format_keeps_one_group_and_its_anchor() {
    for (clear, ranges, formula) in [("A1", "A2 C1:C2", "A2&gt;0"), ("C1", "A1:A2 C2", "A1&gt;0")] {
        let (workbook, _) =
            Workbook::from_xlsx_bytes(include_bytes!("fixtures/clear_metadata_multi.xlsx"))
                .unwrap();
        run_office_js_with_workbook(&workbook,&format!(r#"
          await Excel.run(async c=>{{
            c.workbook.worksheets.getItem("Sheet1").getRange("{clear}").clear("All"); await c.sync();
          }});
        "#)).unwrap();
        let xml = sheet_xml(&workbook);
        assert_eq!(xml.matches("<conditionalFormatting ").count(), 1, "{xml}");
        assert!(
            xml.contains("type=\"top10\"") && xml.contains("rank=\"1\""),
            "{xml}"
        );
        let part = xml
            .split("<conditionalFormatting ")
            .nth(1)
            .unwrap()
            .split("</conditionalFormatting>")
            .next()
            .unwrap();
        assert!(
            part.contains(&format!("sqref=\"{ranges}\"")) && part.contains(formula),
            "{clear}: {part}"
        );
    }
}
