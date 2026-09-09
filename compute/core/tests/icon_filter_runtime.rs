//! Production XLSX import/apply/reapply contracts for conditional-format icon filters.
use cell_types::{SheetId, SheetPos};
use compute_core::bridge_types::CellInput;
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::ColumnFilter;
use value_types::CellValue;
use xlsx_parser::write::ZipWriter;

fn fixture(
    set: &str,
    count: usize,
    reversed: bool,
    table: bool,
    icon_id: Option<u32>,
    custom: bool,
) -> Vec<u8> {
    let main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    let rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    let end = count + 1;
    let mut rows = String::from(
        r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Label</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row>"#,
    );
    for bucket in 0..count {
        let row = bucket + 2;
        rows.push_str(&format!(r#"<row r="{row}"><c r="A{row}" t="inlineStr"><is><t>Item{bucket}</t></is></c><c r="B{row}"><v>{}</v></c></row>"#,bucket*20+10));
    }
    // Text without a CF icon exercises the omitted iconId/no-icon criterion.
    let last = end + 1;
    rows.push_str(&format!(r#"<row r="{last}"><c r="A{last}" t="inlineStr"><is><t>Text</t></is></c><c r="B{last}" t="inlineStr"><is><t>none</t></is></c></row><row r="12"><c r="B12"><f>SUBTOTAL(9,B2:B{last})</f><v>0</v></c></row><row r="13"><c r="B13"><f>SUBTOTAL(109,B2:B{last})</f><v>0</v></c></row>"#));
    let thresholds = (0..count)
        .map(|index| format!(r#"<cfvo type="num" val="{}"/>"#, index * 20))
        .collect::<String>();
    let icon_attr = icon_id
        .map(|id| format!(r#" iconId="{id}""#))
        .unwrap_or_default();
    let filter = format!(
        r#"<autoFilter ref="A1:B{last}"><filterColumn colId="1"><iconFilter iconSet="{set}"{icon_attr}/></filterColumn></autoFilter>"#
    );
    let mut zip = ZipWriter::new();
    zip.add_file("[Content_Types].xml",format!(r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>"#).into_bytes());
    zip.add_file("_rels/.rels",format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>"#).into_bytes());
    zip.add_file("xl/workbook.xml",format!(r#"<workbook xmlns="{main}" xmlns:r="{rel}"><sheets><sheet name="Icons" sheetId="1" r:id="r1"/></sheets></workbook>"#).into_bytes());
    zip.add_file("xl/_rels/workbook.xml.rels",format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#).into_bytes());
    let table_part = if table {
        r#"<tableParts count="1"><tablePart r:id="t1"/></tableParts>"#
    } else {
        ""
    };
    let cf = if custom {
        // Custom icon 2 of 5Arrows replaces the lowest bucket; no icon replaces
        // the middle bucket. The highest bucket uses icon 0 of 4Rating.
        format!(
            r#"<extLst><ext uri="{{78C0D931-6437-407d-A8EE-F0AAD7539E65}}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormattings><x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:cfRule type="iconSet" priority="1" id="{{11111111-1111-1111-1111-111111111111}}"><x14:iconSet iconSet="3Arrows" custom="1"><x14:cfvo type="num"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="num"><xm:f>20</xm:f></x14:cfvo><x14:cfvo type="num"><xm:f>40</xm:f></x14:cfvo><x14:cfIcon iconSet="5Arrows" iconId="2"/><x14:cfIcon iconSet="NoIcons" iconId="0"/><x14:cfIcon iconSet="4Rating" iconId="0"/></x14:iconSet></x14:cfRule><xm:sqref>B2:B{end}</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>"#
        )
    } else {
        format!(
            r#"<conditionalFormatting sqref="B2:B{end}"><cfRule type="iconSet" priority="1"><iconSet iconSet="{set}" reverse="{}">{thresholds}</iconSet></cfRule></conditionalFormatting>"#,
            u8::from(reversed)
        )
    };
    zip.add_file("xl/worksheets/sheet1.xml",format!(r#"<worksheet xmlns="{main}" xmlns:r="{rel}"><sheetData>{rows}</sheetData>{}{cf}{table_part}</worksheet>"#,if table {""} else {&filter}).into_bytes());
    if table {
        zip.add_file("xl/worksheets/_rels/sheet1.xml.rels",format!(r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="t1" Type="{rel}/table" Target="../tables/table1.xml"/></Relationships>"#).into_bytes());
        zip.add_file("xl/tables/table1.xml",format!(r#"<table xmlns="{main}" id="1" name="IconData" displayName="IconData" ref="A1:B{last}" totalsRowShown="0">{filter}<tableColumns count="2"><tableColumn id="1" name="Label"/><tableColumn id="2" name="Amount"/></tableColumns></table>"#).into_bytes());
    }
    zip.finish().unwrap()
}

fn loaded(bytes: &[u8]) -> (YrsComputeEngine, SheetId, String) {
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(bytes).unwrap();
    let sheet = engine.mirror().sheet_by_name("Icons").unwrap();
    let filter = engine
        .get_filters_in_sheet(&sheet)
        .into_iter()
        .next()
        .unwrap();
    assert!(
        !filter.column_filters.is_empty(),
        "icon criterion must be executable"
    );
    (engine, sheet, filter.id)
}
fn value(engine: &YrsComputeEngine, sheet: &SheetId, row: u32) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sheet, SheetPos::new(row, 1))
        .cloned()
        .unwrap_or(CellValue::Null)
}

#[test]
fn imported_icon_filters_cover_all_families_both_directions_and_owners() {
    for name in compute_cf::types::CFIconSetName::SERDE_NAMES
        .iter()
        .take(20)
    {
        let set: compute_cf::types::CFIconSetName =
            serde_json::from_value(serde_json::json!(name)).unwrap();
        let count = set.icon_count();
        for reversed in [false, true] {
            for table in [false, true] {
                let (mut engine, sheet, filter) =
                    loaded(&fixture(name, count, reversed, table, Some(1), false));
                engine.recalculate().unwrap();
                let expected = ((if reversed { count - 2 } else { 1 }) * 20 + 10) as f64;
                for row in [11, 12] {
                    assert_eq!(
                        value(&engine, &sheet, row),
                        CellValue::number(expected),
                        "{name} reverse={reversed} table={table}"
                    );
                }
                let record = engine.get_filtered_record_count(&sheet, &filter).unwrap();
                assert_eq!(record.visible, 1);
                engine.reapply_filter(&sheet, &filter).unwrap();
                assert_eq!(value(&engine, &sheet, 11), CellValue::number(expected));
            }
        }
    }
}

#[test]
fn reapply_uses_live_values_and_missing_index_means_no_icon() {
    for table in [false, true] {
        let (mut engine, sheet, filter) =
            loaded(&fixture("3TrafficLights1", 3, false, table, Some(1), false));
        engine
            .batch_set_cells_by_position(
                vec![
                    (
                        sheet,
                        2,
                        1,
                        CellInput::Value {
                            value: CellValue::number(60.0),
                        },
                    ),
                    (
                        sheet,
                        1,
                        1,
                        CellInput::Value {
                            value: CellValue::number(25.0),
                        },
                    ),
                ],
                true,
            )
            .unwrap();
        engine.reapply_filter(&sheet, &filter).unwrap();
        assert_eq!(value(&engine, &sheet, 11), CellValue::number(25.0));
        assert!(!engine.mirror().is_row_hidden(&sheet, 1));
        assert!(engine.mirror().is_row_hidden(&sheet, 2));
        engine
            .set_column_filter(
                &sheet,
                &filter,
                1,
                ColumnFilter::Icon {
                    icon_set_name: "3TrafficLights1".into(),
                    icon_index: None,
                },
            )
            .unwrap();
        engine.apply_filter(&sheet, &filter).unwrap();
        assert_eq!(
            engine
                .get_filtered_record_count(&sheet, &filter)
                .unwrap()
                .visible,
            1
        );
        assert!(!engine.mirror().is_row_hidden(&sheet, 4));
        let bytes = engine.export_to_xlsx_bytes().unwrap();
        let (mut restored, sheet, filter) = loaded(&bytes);
        restored.reapply_filter(&sheet, &filter).unwrap();
        assert_eq!(
            restored
                .get_filtered_record_count(&sheet, &filter)
                .unwrap()
                .visible,
            1
        );
        assert!(!restored.mirror().is_row_hidden(&sheet, 4));
    }
}

#[test]
fn custom_icon_identity_includes_lowest_bucket_and_hidden_icon() {
    let (mut engine, sheet, filter) = loaded(&fixture("5Arrows", 3, false, true, Some(2), true));
    engine.reapply_filter(&sheet, &filter).unwrap();
    assert_eq!(value(&engine, &sheet, 11), CellValue::number(10.0));
    engine
        .set_column_filter(
            &sheet,
            &filter,
            1,
            ColumnFilter::Icon {
                icon_set_name: "4Rating".into(),
                icon_index: Some(0),
            },
        )
        .unwrap();
    engine.apply_filter(&sheet, &filter).unwrap();
    assert_eq!(value(&engine, &sheet, 11), CellValue::number(50.0));
    engine
        .set_column_filter(
            &sheet,
            &filter,
            1,
            ColumnFilter::Icon {
                icon_set_name: "".into(),
                icon_index: None,
            },
        )
        .unwrap();
    engine.apply_filter(&sheet, &filter).unwrap();
    assert_eq!(value(&engine, &sheet, 11), CellValue::number(30.0));
    assert_eq!(
        engine
            .get_filtered_record_count(&sheet, &filter)
            .unwrap()
            .visible,
        2
    );
}

fn rewrite_sheet(bytes: &[u8], change: impl FnOnce(String) -> String) -> Vec<u8> {
    let archive = xlsx_parser::XlsxArchive::new(bytes).unwrap();
    let sheet = String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let replacement = change(sheet).into_bytes();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let name = &entry.name;
        let data = if name == "xl/worksheets/sheet1.xml" {
            replacement.clone()
        } else {
            archive.read_file(name).unwrap()
        };
        zip.add_file(name, data);
    }
    zip.finish().unwrap()
}

#[test]
fn icon_filters_share_percentile_statistics_and_stop_if_true_priority() {
    for kind in ["percent", "percentile"] {
        let bytes = rewrite_sheet(
            &fixture("3Arrows", 3, false, false, Some(1), false),
            |xml| {
                xml.replace(
                    r#"type="num" val="0""#,
                    &format!(r#"type="{kind}" val="0""#),
                )
                .replace(
                    r#"type="num" val="20""#,
                    &format!(r#"type="{kind}" val="33""#),
                )
                .replace(
                    r#"type="num" val="40""#,
                    &format!(r#"type="{kind}" val="67""#),
                )
            },
        );
        let (mut engine, sheet, filter) = loaded(&bytes);
        engine.reapply_filter(&sheet, &filter).unwrap();
        assert_eq!(value(&engine, &sheet, 11), CellValue::number(30.0));
    }
    let bytes = rewrite_sheet(
        &fixture("3Arrows", 3, false, false, Some(1), false),
        |xml| {
            xml.replace(
                r#"<conditionalFormatting sqref="B2:B4">"#,
                r#"<conditionalFormatting sqref="B3"><cfRule type="iconSet" priority="0" stopIfTrue="1"><iconSet iconSet="3Flags"><cfvo type="num" val="0"/><cfvo type="num" val="20"/><cfvo type="num" val="40"/></iconSet></cfRule></conditionalFormatting><conditionalFormatting sqref="B2:B4">"#,
            )
        },
    );
    let (mut engine, sheet, filter) = loaded(&bytes);
    engine.reapply_filter(&sheet, &filter).unwrap();
    assert_eq!(value(&engine, &sheet, 11), CellValue::number(0.0));
    assert_eq!(
        engine
            .get_filtered_record_count(&sheet, &filter)
            .unwrap()
            .visible,
        0
    );
}

#[test]
fn empty_style_stop_filters_icons_across_import_reapply_and_live_edits() {
    for table in [false, true] {
        let bytes = rewrite_sheet(
            &fixture("3TrafficLights1", 3, false, table, Some(1), false),
            |xml| {
                xml.replace(r#"<row r="3">"#, r#"<row r="3" hidden="1">"#)
                    .replace(
                        r#"<cfRule type="iconSet" priority="1">"#,
                        r#"<cfRule type="cellIs" operator="greaterThanOrEqual" priority="0" stopIfTrue="1"><formula>30</formula></cfRule><cfRule type="iconSet" priority="1">"#,
                    )
            },
        );
        let (mut engine, sheet, filter) = loaded(&bytes);
        engine.recalculate().unwrap();
        for row in [11, 12] {
            assert_eq!(value(&engine, &sheet, row), CellValue::number(0.0));
        }
        engine.reapply_filter(&sheet, &filter).unwrap();
        assert_eq!(value(&engine, &sheet, 11), CellValue::number(0.0));
        let (mut restored, restored_sheet, restored_filter) =
            loaded(&engine.export_to_xlsx_bytes().unwrap());
        restored
            .reapply_filter(&restored_sheet, &restored_filter)
            .unwrap();
        for row in [11, 12] {
            assert_eq!(
                value(&restored, &restored_sheet, row),
                CellValue::number(0.0)
            );
        }

        // Previously filtered rows become matching rows when their current values
        // no longer trigger the empty-style stop rule.
        engine
            .batch_set_cells_by_position(
                vec![
                    (
                        sheet,
                        1,
                        1,
                        CellInput::Value {
                            value: CellValue::number(25.0),
                        },
                    ),
                    (
                        sheet,
                        2,
                        1,
                        CellInput::Value {
                            value: CellValue::number(20.0),
                        },
                    ),
                ],
                true,
            )
            .unwrap();
        engine.reapply_filter(&sheet, &filter).unwrap();
        for row in [11, 12] {
            assert_eq!(value(&engine, &sheet, row), CellValue::number(45.0));
        }
        assert!(!engine.mirror().is_row_hidden(&sheet, 2));

        // No-icon filtering selects stopped numeric cells as well as plain text.
        engine
            .set_column_filter(
                &sheet,
                &filter,
                1,
                ColumnFilter::Icon {
                    icon_set_name: "3TrafficLights1".into(),
                    icon_index: None,
                },
            )
            .unwrap();
        engine.apply_filter(&sheet, &filter).unwrap();
        for row in [11, 12] {
            assert_eq!(value(&engine, &sheet, row), CellValue::number(50.0));
        }
        assert_eq!(
            engine
                .get_filtered_record_count(&sheet, &filter)
                .unwrap()
                .visible,
            2
        );
        engine
            .batch_set_cells_by_position(
                vec![(
                    sheet,
                    3,
                    1,
                    CellInput::Value {
                        value: CellValue::number(29.0),
                    },
                )],
                true,
            )
            .unwrap();
        engine.reapply_filter(&sheet, &filter).unwrap();
        assert_eq!(value(&engine, &sheet, 11), CellValue::number(0.0));
        assert_eq!(
            engine
                .get_filtered_record_count(&sheet, &filter)
                .unwrap()
                .visible,
            1
        );
    }
}
