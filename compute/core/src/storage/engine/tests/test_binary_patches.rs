//! Group 8: Binary mutation patch display text regression tests.

use super::super::*;
use super::helpers::*;
use compute_wire::constants::{MUTATION_HEADER_SIZE, NO_STRING, PATCH_STRIDE};
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Test 31: set_cell binary patches contain display_text
// -------------------------------------------------------------------

#[test]
fn test_set_cell_binary_patches_contain_display_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    // Register viewport covering the cell we'll edit
    engine.register_viewport("main", &sid, 0, 0, 100, 26);

    // Edit A1 to "42" -- should produce binary patches with display_text "42"
    let (patches, mutation_result) = engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "42".into() },
        )
        .unwrap();

    // Verify the JSON MutationResult has display_text populated
    let a1_change = mutation_result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((0, 0)))
        .expect("A1 should be in changed_cells");
    assert!(
        a1_change.display_text.is_some(),
        "JSON MutationResult should have display_text populated"
    );

    // Now verify the BINARY patches also have display_text (this is the regression check)
    let mutation_bytes =
        extract_first_viewport_mutation(&patches).expect("should have viewport patches");
    let display_info = extract_patch_display_info(&mutation_bytes);

    // Find the patch for A1 (row=0, col=0)
    let has_display_text = display_info
        .iter()
        .any(|(off, len)| *off != NO_STRING && *len > 0);
    assert!(
        has_display_text,
        "Binary patches must contain display_text. Got NO_STRING for all patches -- \
         this means enrich_display_text() was called AFTER binary serialization."
    );

    // Verify the actual text content
    let text = decode_patch_display_text(&mutation_bytes, 0);
    assert!(
        text.is_some(),
        "Should be able to decode display_text from binary patch string pool"
    );
}

// -------------------------------------------------------------------
// Test 32: apply_mutation(SetCells) binary patches contain display_text
// -------------------------------------------------------------------

#[test]
fn test_apply_mutation_set_cells_patches_contain_display_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 100, 26);

    // Use apply_mutation with SetCells variant (the batch path)
    use crate::bridge_types::CellInput;
    let edits = vec![(
        sid,
        cell_id_a1(),
        0u32,
        0u32,
        CellInput::Parse {
            text: "99".to_string(),
        },
    )];
    let output = engine
        .apply_mutation(EngineMutation::SetCells {
            edits,
            skip_cycle_check: false,
        })
        .unwrap();

    let (patches, result) = match output {
        MutationOutput::Recalc(r) => (engine.flush_viewport_patches(), r),
        _ => panic!("expected Recalc output"),
    };

    // JSON side should have display_text
    let change = result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((0, 0)))
        .expect("A1 should be in changed_cells");
    assert!(
        change.display_text.is_some(),
        "JSON MutationResult.changed_cells should have display_text"
    );

    // Binary patches should ALSO have display_text
    let mutation_bytes =
        extract_first_viewport_mutation(&patches).expect("should have viewport patches");
    let display_info = extract_patch_display_info(&mutation_bytes);
    let has_display_text = display_info
        .iter()
        .any(|(off, len)| *off != NO_STRING && *len > 0);
    assert!(
        has_display_text,
        "Binary patches from apply_mutation(SetCells) must contain display_text. \
         If this fails, enrich_display_text() is being called AFTER binary serialization."
    );
}

// -------------------------------------------------------------------
// Test 33: apply_mutation(SetCellsByPosition) patches contain display_text
// -------------------------------------------------------------------

#[test]
fn test_apply_mutation_set_cells_by_position_patches_contain_display_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 100, 26);

    // Use SetCellsByPosition -- the path that resolves positions internally
    use crate::bridge_types::CellInput;
    let edits = vec![(
        sid,
        0u32,
        0u32,
        CellInput::Parse {
            text: "77".to_string(),
        },
    )];
    let output = engine
        .apply_mutation(EngineMutation::SetCellsByPosition {
            edits,
            skip_cycle_check: false,
        })
        .unwrap();

    let (patches, result) = match output {
        MutationOutput::Recalc(r) => (engine.flush_viewport_patches(), r),
        _ => panic!("expected Recalc output"),
    };

    // JSON side
    let change = result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((0, 0)))
        .expect("A1 should be in changed_cells");
    assert!(change.display_text.is_some());

    // Binary side
    let mutation_bytes =
        extract_first_viewport_mutation(&patches).expect("should have viewport patches");
    let display_info = extract_patch_display_info(&mutation_bytes);
    let has_display_text = display_info
        .iter()
        .any(|(off, len)| *off != NO_STRING && *len > 0);
    assert!(
        has_display_text,
        "Binary patches from apply_mutation(SetCellsByPosition) must contain display_text."
    );
}

// -------------------------------------------------------------------
// Test 34: Formula recalc binary patches contain display_text
// -------------------------------------------------------------------

#[test]
fn test_formula_recalc_binary_patches_contain_display_text() {
    let snap = simple_snapshot(); // A1=10, B1=20, A2=A1+B1=30
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    engine.register_viewport("main", &sid, 0, 0, 100, 26);

    // Change A1 from 10 to 50 -- A2 should recalc to 50+20=70
    let (patches, result) = engine
        .set_cell(
            &sid,
            cell_id_a1(),
            0,
            0,
            crate::bridge_types::CellInput::Parse { text: "50".into() },
        )
        .unwrap();

    // A2 (the formula cell) should be in changed_cells with display_text
    let a2_change = result
        .recalc
        .changed_cells
        .iter()
        .find(|c| c.position.as_ref().map(|p| (p.row, p.col)) == Some((1, 0)))
        .expect("A2 (formula cell) should be in changed_cells after A1 edit");
    assert!(
        a2_change.display_text.is_some(),
        "A2 formula recalc JSON should have display_text"
    );
    assert_eq!(
        a2_change.display_text.as_deref(),
        Some("70"),
        "A2 should display 70 (50+20)"
    );

    // Now verify the BINARY patch for A2 also has display_text
    let mutation_bytes =
        extract_first_viewport_mutation(&patches).expect("should have viewport patches");
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;

    // Find the A2 patch (row=1, col=0) and verify its display_text
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;

    let mut found_a2 = false;
    for i in 0..patch_count {
        let patch_off = patches_start + i * PATCH_STRIDE;
        let row = u32::from_le_bytes([
            mutation_bytes[patch_off],
            mutation_bytes[patch_off + 1],
            mutation_bytes[patch_off + 2],
            mutation_bytes[patch_off + 3],
        ]);
        let col = u32::from_le_bytes([
            mutation_bytes[patch_off + 4],
            mutation_bytes[patch_off + 5],
            mutation_bytes[patch_off + 6],
            mutation_bytes[patch_off + 7],
        ]);
        if row == 1 && col == 0 {
            found_a2 = true;
            let text = decode_patch_display_text(&mutation_bytes, i);
            assert_eq!(
                text.as_deref(),
                Some("70"),
                "Binary patch for A2 must contain display_text '70'. \
                 If this is None, enrich_display_text() ran after binary serialization."
            );
        }
    }
    assert!(
        found_a2,
        "Binary patches should include a patch for formula cell A2"
    );
}
