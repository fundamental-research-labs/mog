//! Real ZIP fixtures at the native XLSX reader boundary, without services.
//!
//! A relationship-only rewrite misses Override lookup, percent-escape case,
//! and collisions between physical names. The native parser opts into one OPC
//! index that resolves queries to original entries; ordinary ZIP access keeps
//! exact names. Neither approach decodes `%20` into a space or rewrites bytes.

use xlsx_parser::domain::content_types::read::ContentTypes;
use xlsx_parser::{XlsxArchive, ZipWriter, parse_xlsx_full_native};

const MAIN: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const WORKSHEET: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const SHEET: &[u8] = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1"><f>A1*2</f><v>84</v></c></row></sheetData></worksheet>"#;

fn workbook(target: &str, override_name: &str, physical: Option<&str>, sheet: &[u8], extras: &[&str]) -> Vec<u8> {
    let mut zip = ZipWriter::new();
    zip.add_file("[Content_Types].xml", format!(
        r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="{MAIN}"/><Override PartName="{override_name}" ContentType="{WORKSHEET}"/></Types>"#
    ));
    zip.add_file("_rels/.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#);
    zip.add_file("xl/workbook.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Model" sheetId="1" r:id="rId1"/></sheets></workbook>"#);
    zip.add_file("xl/_rels/workbook.xml.rels", format!(
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="{target}"/></Relationships>"#
    ));
    if let Some(name) = physical {
        zip.add_file(name, sheet);
    }
    for name in extras {
        zip.add_file(name, SHEET);
    }
    zip.finish().expect("synthetic ZIP")
}

#[test]
fn opc_relationship_and_override_names_load_exact_cached_cells() {
    for (target, override_name, physical) in [
        ("worksheets/sheet1.xml", "/xl/worksheets/sheet1.xml", "xl/worksheets/sheet1.xml"),
        ("worksheets/Sheet%201.xml", "/xl/worksheets/Sheet%201.xml", "xl/worksheets/Sheet%201.xml"),
        ("worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml", "xl/worksheets/R%C3%A9sum%C3%A9.xml"),
        ("/xl/worksheets/Résumé.xml", "/xl/worksheets/R%C3%A9sum%C3%A9.xml", "xl/worksheets/R%C3%A9sum%C3%A9.xml"),
        ("./worksheets/../worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml", "XL/Worksheets/R%c3%a9sum%c3%a9.XML"),
    ] {
        let bytes = workbook(target, override_name, Some(physical), SHEET, &[]);
        let result = parse_xlsx_full_native(&bytes, None).expect(target);
        assert_eq!(result.sheets.len(), 1);
        assert_eq!(result.sheets[0].name, "Model");
        assert_eq!(result.sheets[0].owner_part_path.as_deref(), Some(physical));
        let a1 = result.sheets[0].cells.iter().find(|c| c.row == 0 && c.col == 0).expect("A1");
        let b1 = result.sheets[0].cells.iter().find(|c| c.row == 0 && c.col == 1).expect("B1");
        assert_eq!(a1.value.as_deref(), Some("42"));
        assert_eq!(b1.value.as_deref(), Some("84"));
        assert_eq!(b1.formula.as_deref(), Some("A1*2"));
        assert!(XlsxArchive::new(&bytes).unwrap().entries().iter().any(|e| e.name == physical));
    }
}

#[test]
fn generic_zip_access_keeps_exact_physical_names() {
    let physical = "xl/worksheets/R%C3%A9sum%C3%A9.xml";
    let bytes = workbook("worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml", Some(physical), SHEET, &[]);
    let raw = XlsxArchive::new(&bytes).unwrap();
    assert_eq!(raw.read_file(physical).unwrap(), SHEET);
    for alias in ["xl/worksheets/Résumé.xml", "XL/WORKSHEETS/R%C3%A9sum%C3%A9.xml"] {
        assert!(!raw.contains(alias));
        assert!(raw.read_file(alias).is_err());
    }
}

#[test]
fn opc_collisions_and_invalid_names_are_not_selected_as_aliases() {
    let physical = "xl/worksheets/R%C3%A9sum%C3%A9.xml";
    for alias in ["xl/worksheets/R%c3%a9sum%c3%a9.xml", "XL/WORKSHEETS/R%C3%A9sum%C3%A9.xml", "xl/worksheets/Résumé.xml"] {
        let bytes = workbook("worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml", Some(physical), SHEET, &[alias]);
        assert!(parse_xlsx_full_native(&bytes, None).unwrap_err().contains("colliding OPC"));
    }
    for name in ["bad%.xml", "bad%zz.xml", "bad%2fname.xml", "bad%5cname.xml", "%2e%2e", "bad%ff.xml", "bad%41.xml"] {
        // An unsupported logical name must not acquire a decoded alias to
        // another physical entry. Its old exact-literal behavior is separate.
        let bytes = workbook(&format!("worksheets/{name}"), &format!("/xl/worksheets/{name}"), Some("xl/worksheets/safe.xml"), SHEET, &[]);
        assert!(parse_xlsx_full_native(&bytes, None).is_err(), "{name}");
    }
    let bytes = workbook("worksheets/Sheet%201.xml", "/xl/worksheets/Sheet%201.xml", Some("xl/worksheets/Sheet 1.xml"), SHEET, &[]);
    assert!(parse_xlsx_full_native(&bytes, None).is_err(), "%20 must not decode to a raw space");
}

#[test]
fn unsupported_unreferenced_names_keep_existing_reader_behavior() {
    let bytes = workbook("worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml",
        Some("xl/worksheets/R%C3%A9sum%C3%A9.xml"), SHEET,
        &["extras/Sheet 1.xml", "extras/bad%.xml", "extras/bad%2f.xml"]);
    let archive = XlsxArchive::new(&bytes).unwrap();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let mut data = archive.read_file(&entry.name).unwrap();
        if entry.name == "[Content_Types].xml" {
            data = String::from_utf8(data).unwrap().replace("</Types>",
                r#"<Override PartName="/extras/Sheet 1.xml" ContentType="application/xml"/></Types>"#).into_bytes();
        }
        zip.add_file(&entry.name, data);
    }
    let bytes = zip.finish().unwrap();
    let parsed = parse_xlsx_full_native(&bytes, None).expect("unrelated unsupported extras");
    let cell = parsed.sheets[0].cells.iter().find(|cell| cell.row == 0 && cell.col == 0).unwrap();
    assert_eq!(cell.value.as_deref(), Some("42"));
}

#[test]
fn default_only_content_types_match_extension_case_without_changing_spelling() {
    let physical = "xl/worksheets/R%C3%A9sum%C3%A9.XML";
    let bytes = workbook("worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml", Some(physical), SHEET, &[]);
    let archive = XlsxArchive::new(&bytes).unwrap();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let mut data = archive.read_file(&entry.name).unwrap();
        if entry.name == "[Content_Types].xml" {
            let xml = String::from_utf8(data).unwrap()
                .replace(r#"<Override PartName="/xl/worksheets/Résumé.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#, "")
                .replace(r#"Extension="xml" ContentType="application/xml""#,
                    &format!(r#"Extension="xml" ContentType="{WORKSHEET}""#));
            let types = ContentTypes::parse(xml.as_bytes()).unwrap();
            assert_eq!(types.get_type(physical), Some(WORKSHEET));
            assert_eq!(types.ordered_defaults().find(|(ext, _)| *ext == "xml"), Some(("xml", WORKSHEET)));
            data = xml.into_bytes();
        }
        zip.add_file(&entry.name, data);
    }
    assert_eq!(parse_xlsx_full_native(&zip.finish().unwrap(), None).unwrap().sheets.len(), 1);
    let types = ContentTypes::parse(format!(r#"<Types><Default Extension="XML" ContentType="{WORKSHEET}"/></Types>"#).as_bytes()).unwrap();
    assert_eq!(types.get_type("xl/worksheets/sheet1.xml"), Some(WORKSHEET));
    assert!(types.has_default("xml"));
    assert_eq!(types.ordered_defaults().next(), Some(("XML", WORKSHEET)));
}

#[test]
fn incompatible_default_is_distinct_from_absent_for_uppercase_physical_extension() {
    let physical = "xl/worksheets/R%C3%A9sum%C3%A9.XML";
    for (remove_default, expected_kind) in [
        (false, domain_types::WorkbookSheetKind::Invalid),
        (true, domain_types::WorkbookSheetKind::Worksheet),
    ] {
        let bytes = workbook("worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml", Some(physical), SHEET, &[]);
        let archive = XlsxArchive::new(&bytes).unwrap();
        let mut zip = ZipWriter::new();
        for entry in archive.entries() {
            let mut data = archive.read_file(&entry.name).unwrap();
            if entry.name == "[Content_Types].xml" {
                let mut xml = String::from_utf8(data).unwrap().replace(
                    r#"<Override PartName="/xl/worksheets/Résumé.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#, "");
                if remove_default {
                    xml = xml.replace(r#"<Default Extension="xml" ContentType="application/xml"/>"#, "");
                }
                let types = ContentTypes::parse(xml.as_bytes()).unwrap();
                assert_eq!(types.get_type(physical), if remove_default { None } else { Some("application/xml") });
                data = xml.into_bytes();
            }
            zip.add_file(&entry.name, data);
        }
        let parsed = parse_xlsx_full_native(&zip.finish().unwrap(), None).unwrap();
        assert_eq!(parsed.workbook_sheet_inventory[0].kind, expected_kind);
        assert_eq!(parsed.sheets.len(), if remove_default { 1 } else { 0 });
    }
}

#[test]
fn override_identity_lookup_preserves_original_spelling_and_rejects_collisions() {
    let xml = format!(r#"<Types><Override PartName="/xl/worksheets/Résumé.xml" ContentType="{WORKSHEET}"/></Types>"#);
    let types = ContentTypes::parse(xml.as_bytes()).unwrap();
    assert_eq!(types.get_type("xl/worksheets/R%C3%A9sum%C3%A9.xml"), Some(WORKSHEET));
    assert_eq!(types.ordered_overrides().next(), Some(("xl/worksheets/Résumé.xml", WORKSHEET)));
    let xml = xml.replace("</Types>", &format!(r#"<Override PartName="/xl/worksheets/R%C3%A9sum%C3%A9.xml" ContentType="{WORKSHEET}"/></Types>"#));
    assert!(ContentTypes::parse(xml.as_bytes()).is_err());
}

const CORRUPTION_PART_NAMES: [(&str, &str, &str); 2] = [
    ("worksheets/sheet1.xml", "/xl/worksheets/sheet1.xml", "xl/worksheets/sheet1.xml"),
    ("worksheets/Résumé.xml", "/xl/worksheets/Résumé.xml", "xl/worksheets/R%C3%A9sum%C3%A9.xml"),
];

#[test]
fn missing_required_parts_fail_for_ascii_and_mapped_names() {
    for (logical, override_name, _) in CORRUPTION_PART_NAMES {
        let bytes = workbook(logical, override_name, None, SHEET, &[]);
        assert!(parse_xlsx_full_native(&bytes, None).is_err(), "{logical}");
    }
}

#[test]
fn invalid_utf8_fails_for_ascii_and_mapped_names() {
    for (logical, override_name, physical) in CORRUPTION_PART_NAMES {
        let bytes = workbook(logical, override_name, Some(physical), b"\xff", &[]);
        let error = parse_xlsx_full_native(&bytes, None).unwrap_err();
        assert!(error.contains("UTF-8"), "{logical}: {error}");
    }
}

#[test]
fn truncated_sheet_data_fails_for_ascii_and_mapped_names() {
    let truncated = br#"<worksheet><sheetData><row><c r="A1"><v>42</v></c></row></worksheet>"#;
    for (logical, override_name, physical) in CORRUPTION_PART_NAMES {
        let bytes = workbook(logical, override_name, Some(physical), truncated, &[]);
        let error = parse_xlsx_full_native(&bytes, None).unwrap_err();
        assert!(error.contains("Truncated worksheet XML"), "{logical}: {error}");
    }
}

#[test]
fn missing_value_end_tag_preserves_existing_lenient_recovery_for_mapped_names() {
    // The cell scanner intentionally recovers a missing </v> as an empty
    // value when </c> and </sheetData> are present. OPC lookup must preserve
    // that existing ASCII behavior, not introduce a stricter XML policy.
    let malformed = b"<worksheet><sheetData><row><c><v>42</c></row></sheetData></worksheet>";
    let mut decoded_cells = Vec::new();
    for (logical, override_name, physical) in CORRUPTION_PART_NAMES {
        let bytes = workbook(logical, override_name, Some(physical), malformed, &[]);
        let parsed = parse_xlsx_full_native(&bytes, None).expect(logical);
        assert_eq!(parsed.workbook_sheet_inventory.len(), 1);
        assert_eq!(parsed.workbook_sheet_inventory[0].kind, domain_types::WorkbookSheetKind::Worksheet);
        assert_eq!(parsed.sheets.len(), 1);
        let sheet = &parsed.sheets[0];
        assert_eq!(sheet.name, "Model");
        assert_eq!(sheet.sheet_id, Some(1));
        assert_eq!(sheet.owner_part_path.as_deref(), Some(physical));
        assert_eq!(sheet.cells.len(), 1);
        let cell = &sheet.cells[0];
        assert_eq!((cell.row, cell.col), (0, 0));
        assert_eq!(cell.value, None);
        assert_eq!(cell.formula, None);
        decoded_cells.push((cell.row, cell.col, cell.value.clone(), cell.formula.clone()));
    }
    assert_eq!(decoded_cells[0], decoded_cells[1]);
}

#[test]
fn crc_failures_are_not_hidden_for_ascii_or_mapped_names() {
    for (logical, override_name, physical) in CORRUPTION_PART_NAMES {
        let mut bytes = workbook(logical, override_name, Some(physical), SHEET, &[]);
        let offset = XlsxArchive::new(&bytes).unwrap().find_entry(physical).unwrap().offset;
        let crc = u32::from_le_bytes(bytes[offset + 14..offset + 18].try_into().unwrap()) ^ 1;
        bytes[offset + 14..offset + 18].copy_from_slice(&crc.to_le_bytes());
        let name = physical.as_bytes();
        let central = bytes.windows(46 + name.len()).position(|window| {
            window.starts_with(b"PK\x01\x02") && &window[46..] == name
        }).expect("worksheet central header");
        bytes[central + 16..central + 20].copy_from_slice(&crc.to_le_bytes());
        let error = parse_xlsx_full_native(&bytes, None).unwrap_err();
        assert!(error.contains("CRC mismatch"), "{logical}: {error}");
    }
}
