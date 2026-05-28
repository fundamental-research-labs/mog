use crate::storage::sheet::floating_objects::compute_object_pixel_bounds;
use compute_layout_index::LayoutIndex;

#[test]
fn test_compute_object_pixel_bounds_projects_emu_anchor_units() {
    let layout = LayoutIndex::with_defaults(
        10,
        10,
        domain_types::units::Pixels(20.0),
        domain_types::units::Pixels(64.0),
    );
    let obj = serde_json::json!({
        "anchor": {
            "anchorMode": "oneCell",
            "anchorRow": 2,
            "anchorCol": 3,
            "anchorRowOffsetEmu": 5 * 9525,
            "anchorColOffsetEmu": 7 * 9525,
            "extentCxEmu": 88 * 9525,
            "extentCyEmu": 44 * 9525
        },
        "rotation": 15
    });

    let bounds = compute_object_pixel_bounds(None, Some(&layout), &obj).unwrap();

    assert_eq!(bounds.x.get(), 3.0 * 64.0 + 7.0);
    assert_eq!(bounds.y.get(), 2.0 * 20.0 + 5.0);
    assert_eq!(bounds.width.get(), 88.0);
    assert_eq!(bounds.height.get(), 44.0);
    assert_eq!(bounds.rotation.get(), 15.0);
}

#[test]
fn test_compute_object_pixel_bounds_projects_two_cell_emu_offsets() {
    let layout = LayoutIndex::with_defaults(
        10,
        10,
        domain_types::units::Pixels(20.0),
        domain_types::units::Pixels(64.0),
    );
    let obj = serde_json::json!({
        "anchor": {
            "anchorMode": "twoCell",
            "anchorRow": 1,
            "anchorCol": 1,
            "anchorRowOffsetEmu": 3 * 9525,
            "anchorColOffsetEmu": 4 * 9525,
            "endRow": 4,
            "endCol": 3,
            "endRowOffsetEmu": 9 * 9525,
            "endColOffsetEmu": 12 * 9525
        }
    });

    let bounds = compute_object_pixel_bounds(None, Some(&layout), &obj).unwrap();

    assert_eq!(bounds.x.get(), 68.0);
    assert_eq!(bounds.y.get(), 23.0);
    assert_eq!(bounds.width.get(), 136.0);
    assert_eq!(bounds.height.get(), 66.0);
}

// -------------------------------------------------------------------
// Floating Object CRUD (opaque JSON API)
// -------------------------------------------------------------------
