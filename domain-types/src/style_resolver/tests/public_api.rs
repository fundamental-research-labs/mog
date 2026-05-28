use super::super::{CellXfInput, FormatCache, StyleInput, resolve_style, resolve_styles};
use super::make_input;

#[test]
fn default_style_resolves_normal_base() {
    let input = make_input();
    let palette = resolve_styles(&input);
    // Style index 0 now resolves the Normal base style from cellStyleXfs[0].
    // The Normal style references font 0 (Calibri, scheme=minor, size=11),
    // which produces a non-default font. Fill/border/numFmt are default.
    let fmt = &palette[0];
    let font = fmt.font.as_ref().expect("Normal style should have font");
    assert_eq!(font.scheme.as_deref(), Some("minor"));
    assert_eq!(font.size, Some(11000));
    assert!(fmt.fill.is_none());
    assert!(fmt.border.is_none());
    assert!(fmt.number_format.is_none());
}

#[test]
fn default_style_is_empty_without_cell_style_xfs() {
    // When no cellStyleXfs are provided, index 0 falls back to default.
    let mut input = make_input();
    input.cell_style_xfs.clear();
    let palette = resolve_styles(&input);
    assert_eq!(palette[0], crate::DocumentFormat::default());
}

#[test]
fn resolve_styles_preserves_indices() {
    let input = make_input();
    let palette = resolve_styles(&input);
    assert_eq!(palette.len(), input.cell_xfs.len());
}

#[test]
fn public_facade_imports_compile() {
    let input = StyleInput {
        cell_xfs: vec![CellXfInput::default()],
        ..Default::default()
    };
    let mut cache = FormatCache::new();

    assert_eq!(resolve_styles(&input).len(), 1);
    assert!(resolve_style(0, &input, &mut cache).is_none());
}
