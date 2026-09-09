use compute_core::storage::engine::ComputeEngine;
use domain_types::{CFRule, CFStyle};
use xlsx_parser::write::{ZipWriter, write_xlsx_from_parse_output};

fn fixture(full_border: bool) -> Vec<u8> {
    let bytes = write_xlsx_from_parse_output(&domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".into(),
            cells: vec![domain_types::CellData {
                value: value_types::CellValue::Number(value_types::FiniteF64::must(1.0)),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let archive = xlsx_parser::XlsxArchive::new(&bytes).unwrap();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let mut data = archive.read_file(&entry.name).unwrap();
        if entry.name == "xl/styles.xml" {
            let xml = String::from_utf8(data).unwrap();
            let dxf = r#"<dxfs count="2"><dxf><font><sz val="16"/><name val="Arial"/><b/><color theme="4" tint="0.25"/></font><fill><patternFill><bgColor theme="4" tint="0.8"/></patternFill></fill><border><top style="thin"><color theme="3"/></top><bottom style="thin"><color theme="3"/></bottom><diagonal style="dashed"><color rgb="FF112233"/></diagonal></border><alignment horizontal="right" wrapText="1"/><protection locked="0" hidden="1"/></dxf><dxf><alignment horizontal="center"/></dxf></dxfs>"#;
            let dxf = if full_border {
                dxf.replace("<border>", r#"<border><left style="thin"><color theme="3"/></left><right style="thin"><color theme="3"/></right>"#)
            } else {
                dxf.to_string()
            };
            data = xml.replace("<dxfs count=\"0\"/>", &dxf).into_bytes();
            assert!(String::from_utf8_lossy(&data).contains("Arial"));
        } else if entry.name == "xl/worksheets/sheet1.xml" {
            data = String::from_utf8(data).unwrap().replace("</worksheet>", r#"<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1" dxfId="0"><formula>A1&gt;0</formula></cfRule><cfRule type="expression" priority="2" dxfId="1"><formula>A1&lt;0</formula></cfRule></conditionalFormatting></worksheet>"#).into_bytes();
        }
        zip.add_file(&entry.name, data);
    }
    zip.finish().unwrap()
}

fn style(rule: &CFRule) -> &CFStyle {
    match rule {
        CFRule::Formula { style, .. } => style,
        _ => panic!("expected expression rule"),
    }
}
fn exported_dxfs(bytes: &[u8]) -> Vec<domain_types::DxfDef> {
    let (parsed, _) = xlsx_parser::parse_xlsx_to_output(bytes).unwrap();
    let registry = parsed.workbook_stylesheet.unwrap().dxf_registry;
    parsed.sheets[0].conditional_formats[0]
        .rules
        .iter()
        .map(|rule| {
            let id = style(rule).dxf_id.unwrap();
            registry.iter().find(|dxf| dxf.id == id).unwrap().clone()
        })
        .collect()
}

#[test]
fn complete_differential_styles_survive_engine_roundtrip_and_property_edit() {
    let input = fixture(false);
    let originals = exported_dxfs(&input);
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&input).unwrap();
    let sheet_id = *engine.mirror().sheet_ids().next().unwrap();
    for _ in 0..2 {
        let saved = engine.export_to_xlsx_bytes().unwrap();
        let dxfs = exported_dxfs(&saved);
        for (expected, actual) in originals.iter().zip(&dxfs) {
            assert_eq!(actual.to_ooxml(), expected.to_ooxml());
        }
        engine = ComputeEngine::from_xlsx_bytes(&saved).unwrap().0;
    }
    let sheet_id = engine
        .mirror()
        .sheet_ids()
        .copied()
        .next()
        .unwrap_or(sheet_id);
    let format = engine.get_all_cf_rules(&sheet_id).remove(0);
    let mut edited = style(&format.rules[0]).clone();
    // Setting one modeled property must not flatten untouched OOXML fields.
    edited.bold = Some(false);
    let id = match &format.rules[0] {
        CFRule::Formula { id, .. } => id,
        _ => unreachable!(),
    };
    engine
        .update_rule_in_cf(
            &sheet_id,
            &format.id,
            id,
            serde_json::json!({"style": edited}),
        )
        .unwrap();
    let saved = engine.export_to_xlsx_bytes().unwrap();
    let mut expected = originals[0].to_ooxml();
    expected.font.as_mut().unwrap().bold = Some(false);
    assert_eq!(exported_dxfs(&saved)[0].to_ooxml(), expected);
    assert_eq!(exported_dxfs(&saved)[1].to_ooxml(), originals[1].to_ooxml());
}

#[test]
fn imported_unified_border_edit_changes_all_four_sides_through_engine() {
    for (full_border, new_style, expected) in [
        (
            true,
            Some(xlsx_parser::domain::styles::types::BorderStyle::Thick),
            "thick",
        ),
        (false, None, "thin"),
    ] {
        let input = fixture(full_border);
        let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&input).unwrap();
        let sheet_id = *engine.mirror().sheet_ids().next().unwrap();
        let format = engine.get_all_cf_rules(&sheet_id).remove(0);
        let mut edited = style(&format.rules[0]).clone();
        edited.border_color = Some("#445566".into());
        edited.border_style = new_style;
        let id = match &format.rules[0] {
            CFRule::Formula { id, .. } => id,
            _ => unreachable!(),
        };
        engine
            .update_rule_in_cf(
                &sheet_id,
                &format.id,
                id,
                serde_json::json!({"style": edited}),
            )
            .unwrap();
        let saved = engine.export_to_xlsx_bytes().unwrap();
        let border = exported_dxfs(&saved)[0].border.clone().unwrap();
        for side in [border.left, border.right, border.top, border.bottom] {
            let side = side.unwrap();
            assert_eq!(side.style.to_ooxml(), expected);
            assert_eq!(
                side.color.unwrap(),
                xlsx_parser::domain::styles::types::ColorDef::Rgb {
                    val: "FF445566".into(),
                    tint: None
                }
            );
        }
    }
}
