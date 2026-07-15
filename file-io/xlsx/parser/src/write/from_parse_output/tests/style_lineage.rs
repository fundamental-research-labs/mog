use super::*;
use crate::domain::styles::write::StylesWriter;
use crate::write::from_parse_output::style_remap::build_style_export_plan;
use ooxml_types::styles::{BorderDef, CellXfDef, FillDef, FontDef, NumberFormatDef};

fn output_with_styles(
    palette: Vec<DocumentFormat>,
    cell_xfs: Vec<CellXfDef>,
    lineage: Vec<DocumentFormat>,
) -> ParseOutput {
    let defaults = StylesWriter::with_defaults();
    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: palette
                .iter()
                .enumerate()
                .map(|(index, _)| DomainCellData {
                    row: index as u32,
                    col: 0,
                    value: DomainValue::Number(FiniteF64::new(index as f64).unwrap()),
                    style_id: Some(index as u32),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }],
        style_palette: palette,
        workbook_stylesheet: Some(WorkbookStylesheet {
            fonts: defaults.fonts,
            fills: defaults.fills,
            borders: defaults.borders,
            cell_style_xfs: defaults.cell_style_xfs,
            cell_xfs,
            cell_xf_lineage: lineage,
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[test]
fn pristine_duplicate_effective_xfs_replay_exact_authored_lineage() {
    let default_xf = StylesWriter::with_defaults().cell_xfs.remove(0);
    let inherited_font_xf = CellXfDef {
        apply_font: Some(false),
        xf_id: Some(0),
        ..default_xf.clone()
    };
    let raw_xfs = vec![default_xf, inherited_font_xf];
    let output = output_with_styles(
        vec![DocumentFormat::default(), DocumentFormat::default()],
        raw_xfs.clone(),
        vec![DocumentFormat::default(), DocumentFormat::default()],
    );

    let plan = build_style_export_plan(&output);

    assert_eq!(&plan.writer.cell_xfs[..2], raw_xfs.as_slice());
    assert_eq!(plan.remapper.emitted_cell_xf_id(0), Some(0));
    assert_eq!(plan.remapper.emitted_cell_xf_id(1), Some(1));
    assert_eq!(plan.writer.cell_xfs[1].apply_font, Some(false));
    assert_eq!(plan.writer.cell_xfs[1].xf_id, Some(0));
}

#[test]
fn edited_style_appends_generated_xf_with_authored_apply_flags() {
    let default_xf = StylesWriter::with_defaults().cell_xfs.remove(0);
    let raw_xfs = vec![default_xf.clone(), default_xf];
    let generated = DocumentFormat {
        font: Some(FontFormat::default()),
        fill: Some(FillFormat {
            pattern_type: Some("none".to_string()),
            ..Default::default()
        }),
        border: Some(BorderFormat::default()),
        number_format: Some("0.000".to_string()),
        ..Default::default()
    };
    let mut output = output_with_styles(
        vec![DocumentFormat::default(), generated],
        raw_xfs.clone(),
        vec![DocumentFormat::default(), DocumentFormat::default()],
    );
    let stylesheet = output.workbook_stylesheet.as_mut().unwrap();
    stylesheet.fonts[0] = FontDef::default();
    stylesheet.fills[0] = FillDef::None;
    stylesheet.borders[0] = BorderDef::default();
    stylesheet.number_formats = vec![NumberFormatDef {
        id: 164,
        format_code: "0.00".to_string(),
    }];

    let plan = build_style_export_plan(&output);
    let emitted = plan.remapper.emitted_cell_xf_id(1).unwrap();
    let generated_xf = &plan.writer.cell_xfs[emitted as usize];

    assert_eq!(&plan.writer.cell_xfs[..2], raw_xfs.as_slice());
    assert_eq!(emitted, 2, "edited styles belong in the generated tail");
    assert_eq!(generated_xf.font_id, Some(0));
    assert_eq!(generated_xf.fill_id, Some(0));
    assert_eq!(generated_xf.border_id, Some(0));
    assert_eq!(generated_xf.num_fmt_id, Some(165));
    assert_eq!(generated_xf.apply_font, Some(true));
    assert_eq!(generated_xf.apply_fill, Some(true));
    assert_eq!(generated_xf.apply_border, Some(true));
    assert_eq!(generated_xf.apply_number_format, Some(true));
}

#[test]
fn invalid_imported_component_reference_is_not_replayed() {
    let default_xf = StylesWriter::with_defaults().cell_xfs.remove(0);
    let invalid_xf = CellXfDef {
        font_id: Some(99),
        ..default_xf.clone()
    };
    let output = output_with_styles(
        vec![DocumentFormat::default(), DocumentFormat::default()],
        vec![default_xf, invalid_xf],
        vec![DocumentFormat::default(), DocumentFormat::default()],
    );

    let plan = build_style_export_plan(&output);
    let emitted = plan.remapper.emitted_cell_xf_id(1).unwrap();

    assert_eq!(emitted, 2);
    assert_ne!(plan.writer.cell_xfs[emitted as usize].font_id, Some(99));
}

#[test]
fn invalid_imported_custom_number_format_reference_is_not_replayed() {
    let default_xf = StylesWriter::with_defaults().cell_xfs.remove(0);
    let invalid_xf = CellXfDef {
        num_fmt_id: Some(999),
        ..default_xf.clone()
    };
    let output = output_with_styles(
        vec![DocumentFormat::default(), DocumentFormat::default()],
        vec![default_xf, invalid_xf],
        vec![DocumentFormat::default(), DocumentFormat::default()],
    );

    let plan = build_style_export_plan(&output);
    let emitted = plan.remapper.emitted_cell_xf_id(1).unwrap();

    assert_eq!(emitted, 2);
    assert_ne!(plan.writer.cell_xfs[emitted as usize].num_fmt_id, Some(999));
}
