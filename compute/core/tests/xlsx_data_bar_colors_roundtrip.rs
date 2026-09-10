//! Authored data-bar colors must survive XLSX → domain → Yrs → XLSX.
use compute_core::storage::engine::ComputeEngine;
use domain_types::{CFColor, CFDataBar, CFRule, ParseOutput, SheetData};
use xlsx_parser::write::{ZipWriter, write_xlsx_from_parse_output};
use xlsx_parser::{XlsxArchive, parse_xlsx_to_output};

fn fixture(cf_xml: &str) -> Vec<u8> {
    let template = write_xlsx_from_parse_output(&ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let archive = XlsxArchive::new(&template).unwrap();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let data = if entry.name == "xl/worksheets/sheet1.xml" {
            format!(r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><sheetData><row r="3"><c r="G3"><v>1</v></c></row></sheetData>{cf_xml}</worksheet>"#).into_bytes()
        } else {
            archive.read_file(&entry.name).unwrap()
        };
        zip.add_file(&entry.name, data);
    }
    zip.finish().unwrap()
}

fn data_bar(output: &ParseOutput) -> &CFDataBar {
    assert_eq!(output.sheets[0].conditional_formats.len(), 1);
    let cf = &output.sheets[0].conditional_formats[0];
    assert_eq!(cf.ranges, vec![domain_types::CFCellRange::new(2, 6, 23, 6)]);
    assert_eq!(cf.rules.len(), 1);
    match &cf.rules[0] {
        CFRule::DataBar { data_bar, .. } => data_bar,
        other => panic!("{other:?}"),
    }
}

fn assert_colors(bar: &CFDataBar, color: &CFColor, extended: bool) {
    assert_eq!(&bar.positive_color, color);
    for role in [
        &bar.border_color,
        &bar.negative_color,
        &bar.negative_border_color,
        &bar.axis_color,
    ] {
        assert_eq!(role.as_ref(), extended.then_some(color));
    }
    assert_eq!(bar.show_value, Some(false));
    assert_eq!(
        bar.min_point.value,
        domain_types::CFValueRef::Percentile { value: 10.0 }
    );
    assert_eq!(
        bar.max_point.value,
        domain_types::CFValueRef::Percentile { value: 90.0 }
    );
}

#[test]
fn data_bar_color_kinds_survive_production_save_and_reopen_in_all_five_roles() {
    let cases = [
        (r#"rgb="FF638EC6""#, CFColor::from("FF638EC6")),
        (
            r#"theme="3" tint="0.39997558519241921""#,
            CFColor {
                theme: Some(3),
                tint: Some(0.39997558519241921),
                ..Default::default()
            },
        ),
        (
            r#"indexed="2" tint="-0.25""#,
            CFColor {
                indexed: Some(2),
                tint: Some(-0.25),
                ..Default::default()
            },
        ),
        (
            r#"auto="1""#,
            CFColor {
                auto: true,
                ..Default::default()
            },
        ),
    ];
    for (attributes, expected) in cases {
        for extended in [false, true] {
            let id = "{821808AA-BA45-45D5-BB3E-6AA59FB09673}";
            let link = if extended {
                format!(
                    r#"<extLst><ext uri="{{B025F937-C7B1-47D3-B67F-A62EFF666E3E}}"><x14:id>{id}</x14:id></ext></extLst>"#
                )
            } else {
                String::new()
            };
            // Deliberately differ from x14 to prove its authored fill overrides the base.
            let base_color = if extended {
                r#"rgb="FF000000""#
            } else {
                attributes
            };
            let mut xml = format!(
                r#"<conditionalFormatting sqref="G3:G24"><cfRule type="dataBar" priority="5"><dataBar showValue="0"><cfvo type="percentile" val="10"/><cfvo type="percentile" val="90"/><color {base_color}/></dataBar>{link}</cfRule></conditionalFormatting>"#
            );
            if extended {
                let colors = [
                    "fillColor",
                    "borderColor",
                    "negativeFillColor",
                    "negativeBorderColor",
                    "axisColor",
                ]
                .map(|role| format!("<x14:{role} {attributes}/>"))
                .join("");
                xml.push_str(&format!(r#"<extLst><ext uri="{{78C0D931-6437-407D-A8EE-F0AAD7539E65}}"><x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{id}"><x14:dataBar border="1"><x14:cfvo type="percentile"><xm:f>10</xm:f></x14:cfvo><x14:cfvo type="percentile"><xm:f>90</xm:f></x14:cfvo>{colors}</x14:dataBar></x14:cfRule><xm:sqref>G3:G24</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst>"#));
            }
            let original = fixture(&xml);
            let (parsed, _) = parse_xlsx_to_output(&original).unwrap();
            assert_colors(data_bar(&parsed), &expected, extended);
            let (engine, _) = ComputeEngine::from_xlsx_bytes(&original).unwrap();
            let snapshot = engine.export_to_parse_output().unwrap();
            assert_colors(data_bar(&snapshot.parse_output), &expected, extended);
            let saved = engine.export_to_xlsx_bytes().unwrap();
            let archive = XlsxArchive::new(&saved).unwrap();
            let sheet_xml =
                String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
            assert!(!sheet_xml.contains(r#"rgb="""#), "{sheet_xml}");
            if extended {
                assert!(sheet_xml.contains("<x14:fillColor "));
            }
            let (reopened, _) = ComputeEngine::from_xlsx_bytes(&saved).unwrap();
            assert_colors(
                data_bar(&reopened.export_to_parse_output().unwrap().parse_output),
                &expected,
                extended,
            );
        }
    }
}
