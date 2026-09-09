//! Both public visible-color and explicit OOXML foreground inputs can author a solid fill.

use domain_types::{
    AuthoredStyleRun, CellData, DocumentFormat, FillFormat, ParseOutput, SheetData,
};
use ooxml_types::styles::{ColorDef, FillDef};
use value_types::CellValue;
use xlsx_parser::{parse_xlsx_to_output, write::write_xlsx_from_parse_output};

#[test]
fn solid_fill_color_roles_preserve_exact_color_and_tint_for_values_and_blanks() {
    for (color, tint, expected) in [
        (
            "#00CC99",
            None,
            ColorDef::Rgb {
                val: "FF00CC99".into(),
                tint: None,
            },
        ),
        (
            "#00CC99",
            Some(-0.25),
            ColorDef::Rgb {
                val: "FF00CC99".into(),
                tint: Some("-0.25".into()),
            },
        ),
        (
            "theme:accent1",
            Some(0.35),
            ColorDef::Theme {
                id: 4,
                tint: Some("0.35".into()),
            },
        ),
    ] {
        for use_foreground in [false, true] {
            let fill = if use_foreground {
                FillFormat {
                    pattern_type: Some("solid".into()),
                    pattern_foreground_color: Some(color.into()),
                    pattern_foreground_color_tint: tint,
                    ..Default::default()
                }
            } else {
                FillFormat {
                    pattern_type: Some("solid".into()),
                    background_color: Some(color.into()),
                    background_color_tint: tint,
                    // The public visible-color shorthand takes precedence when
                    // an explicit foreground is also present.
                    pattern_foreground_color: Some("#FF0000".into()),
                    pattern_foreground_color_tint: Some(0.5),
                    ..Default::default()
                }
            };
            let output = ParseOutput {
                style_palette: vec![
                    DocumentFormat::default(),
                    DocumentFormat {
                        fill: Some(fill),
                        ..Default::default()
                    },
                ],
                sheets: vec![SheetData {
                    name: "Fills".into(),
                    rows: 2,
                    cols: 2,
                    cells: vec![CellData {
                        value: CellValue::number(1.0),
                        style_id: Some(1),
                        ..Default::default()
                    }],
                    authored_style_runs: vec![AuthoredStyleRun {
                        start_row: 1,
                        end_row: 1,
                        start_col: 0,
                        end_col: 1,
                        style_id: 1,
                    }],
                    ..Default::default()
                }],
                ..Default::default()
            };
            let bytes = write_xlsx_from_parse_output(&output).unwrap();
            let parsed = parse_xlsx_to_output(&bytes).unwrap().0;
            let sheet = &parsed.sheets[0];
            let stylesheet = parsed.workbook_stylesheet.as_ref().unwrap();
            assert_eq!(sheet.authored_style_runs.len(), 1);
            for style_id in [
                sheet.cells[0].style_id.unwrap(),
                sheet.authored_style_runs[0].style_id,
            ] {
                let xf = &stylesheet.cell_xfs[style_id as usize];
                let actual = &stylesheet.fills[xf.fill_id.unwrap() as usize];
                assert_eq!(
                    actual,
                    &FillDef::Solid {
                        fg_color: expected.clone()
                    },
                    "{color}, foreground={use_foreground}"
                );
                let fill = parsed.style_palette[style_id as usize]
                    .fill
                    .as_ref()
                    .unwrap();
                assert!(
                    fill.background_color.is_some(),
                    "resolved visible fill must have a color"
                );
            }
            assert_eq!(
                sheet.cells.len(),
                1,
                "styled blanks stay sparse style metadata"
            );
        }
    }
}
