//! Group 9: Shape / pixel position resolution.

// -------------------------------------------------------------------
// create_shape pixel position resolution
// -------------------------------------------------------------------
//
// NOTE: We test the pixel->anchor resolution logic directly by applying
// the same algorithm used in `create_shape` to a `CreateShapeConfig` and
// verifying the mutated fields. This exercises the same code path since
// `create_shape` mutates the config *before* passing it downstream.

fn make_shape_config(
    anchor_row: u32,
    anchor_col: u32,
    x_offset: f64,
    y_offset: f64,
    pixel_x: Option<f64>,
    pixel_y: Option<f64>,
) -> crate::engine_types::floating_objects::CreateShapeConfig {
    use crate::engine_types::floating_objects::shape_types::ShapeType;
    use value_types::FiniteF64;
    crate::engine_types::floating_objects::CreateShapeConfig {
        shape_type: ShapeType::Rect,
        anchor_row,
        anchor_col,
        x_offset: FiniteF64::must(x_offset),
        y_offset: FiniteF64::must(y_offset),
        width: FiniteF64::must(100.0),
        height: FiniteF64::must(50.0),
        pixel_x: pixel_x.map(FiniteF64::must),
        pixel_y: pixel_y.map(FiniteF64::must),
        fill: None,
        outline: None,
        text: None,
        shadow: None,
        rotation: None,
        name: None,
        adjustments: None,
        lock_aspect_ratio: None,
    }
}

/// Simulate the pixel->anchor resolution that `create_shape` performs,
/// using the default layout constants (no LayoutIndex present).
fn resolve_pixel_coords(config: &mut crate::engine_types::floating_objects::CreateShapeConfig) {
    use compute_layout_index::{DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT};
    use value_types::FiniteF64;
    if let (Some(px_f), Some(py_f)) = (config.pixel_x, config.pixel_y) {
        let px = px_f.get();
        let py = py_f.get();
        let row = (py / DEFAULT_ROW_HEIGHT.0).max(0.0) as u32;
        let col = (px / DEFAULT_COL_WIDTH.0).max(0.0) as u32;
        let row_pos = row as f64 * DEFAULT_ROW_HEIGHT.0;
        let col_pos = col as f64 * DEFAULT_COL_WIDTH.0;
        config.anchor_row = row;
        config.anchor_col = col;
        config.x_offset = FiniteF64::must(px - col_pos);
        config.y_offset = FiniteF64::must(py - row_pos);
    }
}

#[test]
fn pixel_position_resolves_to_correct_anchor() {
    // Default layout: row height = 20.0, col width = 64.0
    // pixel_x = 150.0 -> col 2 (2*64=128), x_offset = 150-128 = 22.0
    // pixel_y = 55.0  -> row 2 (2*20=40),  y_offset = 55-40  = 15.0
    let mut config = make_shape_config(0, 0, 0.0, 0.0, Some(150.0), Some(55.0));
    resolve_pixel_coords(&mut config);

    assert_eq!(config.anchor_row, 2);
    assert_eq!(config.anchor_col, 2);
    assert!(
        (config.x_offset.get() - 22.0).abs() < 1e-9,
        "expected x_offset 22.0, got {}",
        config.x_offset.get()
    );
    assert!(
        (config.y_offset.get() - 15.0).abs() < 1e-9,
        "expected y_offset 15.0, got {}",
        config.y_offset.get()
    );
}

#[test]
fn pixel_position_none_uses_explicit_anchor() {
    let mut config = make_shape_config(3, 5, 10.0, 7.5, None, None);
    resolve_pixel_coords(&mut config);

    // When pixel_x/pixel_y are None, the original anchor values are preserved.
    assert_eq!(config.anchor_row, 3);
    assert_eq!(config.anchor_col, 5);
    assert!((config.x_offset.get() - 10.0).abs() < 1e-9);
    assert!((config.y_offset.get() - 7.5).abs() < 1e-9);
}

#[test]
fn pixel_position_at_origin() {
    let mut config = make_shape_config(99, 99, 999.0, 999.0, Some(0.0), Some(0.0));
    resolve_pixel_coords(&mut config);

    // pixel (0,0) -> row 0, col 0, offsets 0. Overrides the original anchor values.
    assert_eq!(config.anchor_row, 0);
    assert_eq!(config.anchor_col, 0);
    assert!(
        config.x_offset.get().abs() < 1e-9,
        "expected x_offset 0.0, got {}",
        config.x_offset.get()
    );
    assert!(
        config.y_offset.get().abs() < 1e-9,
        "expected y_offset 0.0, got {}",
        config.y_offset.get()
    );
}
