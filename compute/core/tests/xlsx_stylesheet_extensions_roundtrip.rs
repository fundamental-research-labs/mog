use compute_core::storage::engine::YrsComputeEngine;
use xlsx_parser::write::{ZipWriter, write_xlsx_from_parse_output};

const EXTENSIONS: &str = r#"<extLst><ext uri="{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}"><x14:slicerStyles defaultSlicerStyle="SlicerStyleLight1"><x14:slicerStyle name="Custom"><x14:slicerStyleElements count="1"><x14:slicerStyleElement type="wholeSlicer" dxfId="1"/></x14:slicerStyleElements></x14:slicerStyle></x14:slicerStyles></ext><ext uri="{9260A510-F301-46a8-8635-F512D64BE5F5}"><x15:timelineStyles defaultTimelineStyle="TimeSlicerStyleLight1"/></ext><ext uri="custom"><vendor:setting value="retained"/></ext></extLst>"#;

fn fixture(include_base_xfs: bool) -> Vec<u8> {
    let bytes = write_xlsx_from_parse_output(&domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sheet1".into(),
            cells: vec![domain_types::CellData {
                row: 0,
                col: 0,
                value: value_types::CellValue::Number(value_types::FiniteF64::must(1.0)),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let archive = xlsx_parser::XlsxArchive::new(&bytes).unwrap();
    let styles = format!(
        r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" xmlns:vendor="urn:example:style">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>{}
<cellXfs count="1"><xf fontId="0" fillId="0" borderId="0" numFmtId="0" xfId="0"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"><extLst><ext uri="named"/></extLst></cellStyle></cellStyles>
<dxfs count="2"><dxf><font><b/></font></dxf><dxf><font><i/></font></dxf></dxfs>{EXTENSIONS}</styleSheet>"#,
        if include_base_xfs {
            r#"<cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0" numFmtId="0"/></cellStyleXfs>"#
        } else {
            ""
        }
    );
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let name = &entry.name;
        zip.add_file(
            name,
            if name == "xl/styles.xml" {
                styles.as_bytes().to_vec()
            } else {
                archive.read_file(name).unwrap()
            },
        );
    }
    zip.finish().unwrap()
}

#[test]
fn stylesheet_extensions_and_referenced_dxfs_survive_engine_edit_and_reload() {
    for include_base_xfs in [true, false] {
        let (mut engine, _) =
            YrsComputeEngine::from_xlsx_bytes(&fixture(include_base_xfs)).unwrap();
        let sid = *engine.mirror().sheet_ids().next().unwrap();
        engine.set_cell_value_as_text(&sid, 0, 0, "edited").unwrap();
        for _ in 0..2 {
            let bytes = engine.export_to_xlsx_bytes().unwrap();
            let archive = xlsx_parser::XlsxArchive::new(&bytes).unwrap();
            let xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
            assert!(xml.contains(EXTENSIONS), "root extensions lost: {xml}");
            assert!(xml.contains(r#"xmlns:vendor="urn:example:style""#));
            let (parsed, _) = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap();
            let stylesheet = parsed.workbook_stylesheet.unwrap();
            assert_eq!(stylesheet.dxf_registry.len(), 2);
            assert_eq!(
                stylesheet.dxf_registry[1].font.as_ref().unwrap().italic,
                Some(true)
            );
            if include_base_xfs {
                assert!(xml.contains(r#"<ext uri="named"/>"#));
            }
            assert_eq!(
                parsed.sheets[0].cells[0].value,
                value_types::CellValue::Text("edited".into())
            );
            engine = YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap().0;
        }
    }
}
