use super::*;
use cell_types::{CellId, SheetId};
use value_types::CellValue;
use xlsx_parser::write::ZipWriter;

fn active_second_sheet_identity_collision_fixture_xlsx() -> Vec<u8> {
    let workbook = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView activeTab="1"/>
  </bookViews>
  <sheets>
    <sheet name="Earlier" sheetId="1" r:id="rId1"/>
    <sheet name="ActiveModel" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"#;
    let sheet1 = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:D1"/>
  <sheetData>
    <row r="1">
      <c r="A1"><v>11</v></c>
      <c r="B1"><v>12</v></c>
      <c r="C1"><v>13</v></c>
      <c r="D1"><v>14</v></c>
    </row>
  </sheetData>
</worksheet>"#;
    let sheet2 = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:A1"/>
  <sheetData>
    <row r="1">
      <c r="A1"><f>1+2</f><v>3</v></c>
    </row>
  </sheetData>
</worksheet>"#;

    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#
            .to_vec(),
    )
    .add_file(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file("xl/workbook.xml", workbook.as_bytes().to_vec())
    .add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file("xl/worksheets/sheet1.xml", sheet1.as_bytes().to_vec())
    .add_file("xl/worksheets/sheet2.xml", sheet2.as_bytes().to_vec());
    zip.finish()
        .expect("write active-second identity collision fixture")
}

fn duplicate_ooxml_sheet_ids_fixture_xlsx() -> Vec<u8> {
    const SHEET_IDS: [u32; 21] = [
        1, 2, 3, 4, 5, 6, 7, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 16, 17, 18, 19,
    ];

    let mut workbook_sheets = String::new();
    let mut workbook_relationships = String::new();
    let mut content_type_overrides = String::new();
    for (idx, sheet_id) in SHEET_IDS.iter().enumerate() {
        let number = idx + 1;
        workbook_sheets.push_str(&format!(
            r#"<sheet name="Sheet {number}" sheetId="{sheet_id}" r:id="rId{number}"/>"#
        ));
        workbook_relationships.push_str(&format!(
            r#"<Relationship Id="rId{number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{number}.xml"/>"#
        ));
        content_type_overrides.push_str(&format!(
            r#"<Override PartName="/xl/worksheets/sheet{number}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
        ));
    }

    let workbook = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets>{workbook_sheets}</sheets>
</workbook>"#
    );
    let workbook_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{workbook_relationships}</Relationships>"#
    );
    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  {content_type_overrides}
</Types>"#
    );

    let mut zip = ZipWriter::new();
    zip.add_file("[Content_Types].xml", content_types.into_bytes())
        .add_file(
            "_rels/.rels",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
                .to_vec(),
        )
        .add_file("xl/workbook.xml", workbook.into_bytes())
        .add_file("xl/_rels/workbook.xml.rels", workbook_rels.into_bytes());
    for number in 1..=SHEET_IDS.len() {
        let worksheet = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1"/>
  <sheetData><row r="1"><c r="A1"><v>{number}</v></c></row></sheetData>
</worksheet>"#
        );
        zip.add_file(
            &format!("xl/worksheets/sheet{number}.xml"),
            worksheet.into_bytes(),
        );
    }
    zip.finish().expect("write duplicate OOXML sheetId fixture")
}

#[test]
fn deferred_full_hydration_does_not_reuse_active_sheet_cell_ids_for_earlier_sheets() {
    let bytes = active_second_sheet_identity_collision_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");

    let sheet_ids = engine.get_all_sheet_ids();
    assert_eq!(sheet_ids.len(), 2);
    let earlier = SheetId::from_uuid_str(&sheet_ids[0]).expect("earlier sheet id");
    let active_model = SheetId::from_uuid_str(&sheet_ids[1]).expect("active model sheet id");
    assert_eq!(engine.get_sheet_name(&earlier).as_deref(), Some("Earlier"));
    assert_eq!(
        engine.get_sheet_name(&active_model).as_deref(),
        Some("ActiveModel")
    );

    let earlier_d1 = engine
        .get_cell_id_at(&earlier, 0, 3)
        .expect("Earlier!D1 should have a cell id");
    let active_a1 = engine
        .get_cell_id_at(&active_model, 0, 0)
        .expect("ActiveModel!A1 should have a cell id");

    assert_ne!(
        earlier_d1, active_a1,
        "full deferred hydration must reserve IDs allocated to the active sheet during first paint"
    );
    assert_eq!(
        engine.get_cell_value(&earlier, 0, 3),
        CellValue::number(14.0)
    );
    assert_eq!(
        engine.get_formula(&CellId::from_uuid_str(&earlier_d1).expect("Earlier!D1 cell id")),
        None,
        "Earlier!D1 must not inherit ActiveModel!A1 formula text through CellId reuse"
    );
    assert_eq!(
        engine.get_formula(&CellId::from_uuid_str(&active_a1).expect("ActiveModel!A1 cell id")),
        Some("=1+2".to_string())
    );
}

#[test]
fn deferred_full_hydration_accepts_duplicate_ooxml_sheet_ids() {
    let bytes = duplicate_ooxml_sheet_ids_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should accept duplicate OOXML sheetIds");
    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should accept duplicate OOXML sheetIds");

    let sheet_ids = engine.get_all_sheet_ids();
    assert_eq!(sheet_ids.len(), 21);
    for (idx, sheet_id) in sheet_ids.iter().enumerate() {
        let sheet_id = SheetId::from_uuid_str(sheet_id).expect("internal sheet id");
        assert_eq!(
            engine.get_sheet_name(&sheet_id),
            Some(format!("Sheet {}", idx + 1))
        );
        assert_eq!(
            engine.get_cell_value(&sheet_id, 0, 0),
            CellValue::number((idx + 1) as f64)
        );
    }
}
