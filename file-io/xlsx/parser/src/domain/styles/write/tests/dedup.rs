use crate::domain::styles::write::{BorderDef, CellXfDef, FillDef, FontDef, StylesWriter};

use super::fixtures::{rgb, thin_side};

#[test]
fn font_fill_border_semantic_reuse_keeps_component_counts() {
    let mut writer = StylesWriter::with_defaults();

    let font = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };
    assert_eq!(writer.add_font(font.clone()), 1);
    assert_eq!(writer.add_font(font), 1);
    assert_eq!(writer.fonts.len(), 2);

    let fill = FillDef::Solid {
        fg_color: rgb("FFFFFF00"),
    };
    assert_eq!(writer.add_fill(fill.clone()), 2);
    assert_eq!(writer.add_fill(fill), 2);
    assert_eq!(writer.fills.len(), 3);

    let border = BorderDef {
        left: Some(thin_side(None)),
        ..Default::default()
    };
    assert_eq!(writer.add_border(border.clone()), 1);
    assert_eq!(writer.add_border(border), 1);
    assert_eq!(writer.borders.len(), 2);
}

#[test]
fn test_cell_xf_not_deduplicated() {
    let mut writer = StylesWriter::new();

    let xf1 = CellXfDef::default();
    let xf2 = CellXfDef::default();

    let id1 = writer.add_cell_xf(xf1);
    let id2 = writer.add_cell_xf(xf2);

    assert_ne!(id1, id2);
    assert_eq!(writer.cell_xfs.len(), 2);
}
