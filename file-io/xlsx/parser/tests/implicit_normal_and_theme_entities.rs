//! Imported defaults and XML text must survive the production parse/export path.

use domain_types::{DocumentFormat, FontFormat, ParseOutput, SheetData};
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::{write_xlsx_from_parse_output, zip_writer::ZipWriter};
use xlsx_parser::zip::XlsxArchive;

const STYLES: &str = r##"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts>
<fonts count="1" x14ac:knownFonts="1"><font><sz val="10"/><name val="Frutiger 45 Light"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFCC00"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="164" fontId="0" fillId="2" borderId="0"><protection locked="0" hidden="1"/></xf></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="164" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyProtection="1"><protection locked="0" hidden="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>"##;

fn base_output() -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".into(),
            rows: 1,
            cols: 1,
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn replace_parts(bytes: &[u8], replacements: &[(&str, &[u8])]) -> Vec<u8> {
    let archive = XlsxArchive::new(bytes).unwrap();
    let mut zip = ZipWriter::new();
    for entry in archive.entries() {
        let data = replacements
            .iter()
            .find(|(name, _)| *name == entry.name)
            .map(|(_, data)| data.to_vec())
            .unwrap_or_else(|| archive.read_file(&entry.name).unwrap());
        zip.add_file(&entry.name, data);
    }
    zip.finish().unwrap()
}

fn imported_with_cells(cells: &str) -> ParseOutput {
    let base = write_xlsx_from_parse_output(&base_output()).unwrap();
    let sheet = format!(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{cells}</sheetData></worksheet>"#
    );
    let bytes = replace_parts(
        &base,
        &[
            ("xl/styles.xml", STYLES.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ],
    );
    parse_xlsx_to_output(&bytes).unwrap().0
}

fn export_and_parse(output: &ParseOutput) -> ParseOutput {
    let bytes = write_xlsx_from_parse_output(output).unwrap();
    parse_xlsx_to_output(&bytes).unwrap().0
}

#[test]
fn implicit_normal_preserves_all_imported_components_and_registry() {
    for cells in [
        r#"<row r="1"><c r="A1"><v>42</v></c></row>"#,
        r#"<row r="1"><c r="A1" s="0"><v>42</v></c></row>"#,
        "",
    ] {
        let imported = imported_with_cells(cells);
        let normal = &imported.style_palette[0];
        let font = normal.font.as_ref().unwrap();
        assert_eq!(font.name.as_deref(), Some("Frutiger 45 Light"));
        assert_eq!(font.size, Some(10_000));
        assert_eq!(normal.number_format.as_deref(), Some("0.0000"));
        assert_eq!(
            normal.fill.as_ref().unwrap().pattern_type.as_deref(),
            Some("solid")
        );
        assert_eq!(normal.protection.as_ref().unwrap().locked, Some(false));
        assert_eq!(normal.protection.as_ref().unwrap().hidden, Some(true));
        assert!(imported.workbook_stylesheet.as_ref().unwrap().known_fonts);
        let exported = export_and_parse(&imported);
        assert_eq!(exported.style_palette, imported.style_palette, "{cells}");
        assert_eq!(
            exported.workbook_stylesheet, imported.workbook_stylesheet,
            "{cells}"
        );
    }
}

#[test]
fn implicit_normal_is_equivalent_to_explicit_style_zero() {
    let implicit = imported_with_cells(r#"<row r="1"><c r="A1"><v>42</v></c></row>"#);
    let explicit = imported_with_cells(r#"<row r="1"><c r="A1" s="0"><v>42</v></c></row>"#);
    assert_eq!(
        export_and_parse(&implicit).workbook_stylesheet,
        export_and_parse(&explicit).workbook_stylesheet
    );
}

#[test]
fn empty_workbook_still_preserves_imported_normal_registry() {
    let imported = imported_with_cells("");
    let empty = ParseOutput {
        style_palette: imported.style_palette.clone(),
        workbook_stylesheet: imported.workbook_stylesheet.clone(),
        ..Default::default()
    };
    let exported = export_and_parse(&empty);
    assert_eq!(exported.style_palette, imported.style_palette);
    assert_eq!(exported.workbook_stylesheet, imported.workbook_stylesheet);
}

#[test]
fn edited_implicit_normal_is_regenerated_from_current_palette() {
    let mut imported = imported_with_cells("");
    imported.style_palette[0].font.as_mut().unwrap().name = Some("Arial".into());
    let exported = export_and_parse(&imported);
    assert_eq!(exported.style_palette[0], imported.style_palette[0]);
}

#[test]
fn generated_empty_sheet_preserves_authored_normal_font() {
    let mut output = base_output();
    output.style_palette = vec![DocumentFormat {
        font: Some(FontFormat {
            name: Some("Arial".into()),
            size: Some(12_000),
            ..Default::default()
        }),
        ..Default::default()
    }];
    let exported = export_and_parse(&output);
    let font = exported.style_palette[0].font.as_ref().unwrap();
    assert_eq!(font.name.as_deref(), Some("Arial"));
    assert_eq!(font.size, Some(12_000));
}

#[test]
fn theme_font_attributes_decode_entities_once_through_package_roundtrip() {
    let collection = r#"
<a:latin typeface="A &amp; B &quot;C&quot; &apos;D&apos; &lt;E>" panose="&#48;2"/>
<a:ea typeface = '&#x5B8B;&#x4F53;' />
<a:cs typeface="&#23435;&#20307;"/>
<a:font script="&#74;pan" typeface="宋体"/>
<a:font script="Hang" typeface="&#x5B8B;&#x4F53;"/>
<a:font script="Hans" typeface="&#23435;&#20307;"/>
<a:font script="Hant" typeface="&amp;#x5B8B;"/>
"#;
    let theme = format!(
        r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test"><a:themeElements><a:clrScheme name="Test"/><a:fontScheme name="A &amp; B"><a:majorFont>{collection}</a:majorFont><a:minorFont>{collection}</a:minorFont></a:fontScheme><a:fmtScheme name="Test"/></a:themeElements></a:theme>"#
    );
    let base = write_xlsx_from_parse_output(&base_output()).unwrap();
    let bytes = replace_parts(&base, &[("xl/theme/theme1.xml", theme.as_bytes())]);
    let imported = parse_xlsx_to_output(&bytes).unwrap().0;
    let scheme = imported
        .theme
        .as_ref()
        .unwrap()
        .font_scheme
        .as_ref()
        .unwrap();
    assert_eq!(scheme.name, "A & B");
    for fonts in [&scheme.major_font, &scheme.minor_font] {
        assert_eq!(fonts.latin.typeface, "A & B \"C\" 'D' <E>");
        assert_eq!(fonts.latin.panose.as_deref(), Some("02"));
        assert_eq!(fonts.ea.typeface, "宋体");
        assert_eq!(fonts.cs.typeface, "宋体");
        assert_eq!(fonts.ea.panose, None);
        assert_eq!(fonts.script_fonts[0].script, "Jpan");
        for font in &fonts.script_fonts[..3] {
            assert_eq!(font.typeface, "宋体");
        }
        assert_eq!(fonts.script_fonts[3].typeface, "&#x5B8B;");
    }
    let exported = export_and_parse(&imported);
    assert_eq!(
        exported.theme.as_ref().unwrap().font_scheme.as_ref(),
        Some(scheme)
    );
    let second_export = export_and_parse(&exported);
    assert_eq!(
        second_export.theme.as_ref().unwrap().font_scheme.as_ref(),
        Some(scheme)
    );
}
