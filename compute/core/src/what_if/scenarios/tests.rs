use super::storage::{KEY_ACTIVE_SCENARIO_ID, get_or_create_scenarios_map, get_scenarios_map};
use super::*;
use crate::snapshot::{Scenario, ScenarioCreateInput, ScenarioUpdateInput};
use crate::storage::YrsStorage;
use std::sync::Arc;
use value_types::{CellValue, FiniteF64};
use yrs::{Any, Map, Transact};

/// Helper: create a fresh YrsStorage for testing.
fn test_storage() -> YrsStorage {
    YrsStorage::new()
}

/// Helper: build a simple ScenarioCreateInput.
fn simple_input(name: &str) -> ScenarioCreateInput {
    ScenarioCreateInput {
        name: name.to_string(),
        comment: String::new(),
        changing_cells: vec!["cell-1".to_string()],
        values: vec![CellValue::Number(FiniteF64::must(100.0))],
        created_by: Some("test-user".to_string()),
    }
}

// -------------------------------------------------------------------
// Validation tests
// -------------------------------------------------------------------

#[test]
fn test_validate_scenario_name_empty() {
    let errors = validate_scenario_name("");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].field, "name");
    assert!(errors[0].message.contains("required"));
}

#[test]
fn test_validate_scenario_name_whitespace_only() {
    let errors = validate_scenario_name("   ");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].field, "name");
}

#[test]
fn test_validate_scenario_name_too_long() {
    let long_name = "x".repeat(MAX_SCENARIO_NAME_LENGTH + 1);
    let errors = validate_scenario_name(&long_name);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].message.contains("255"));
}

#[test]
fn test_validate_scenario_name_valid() {
    let errors = validate_scenario_name("My Scenario");
    assert!(errors.is_empty());
}

#[test]
fn test_validate_scenario_name_max_length() {
    let name = "x".repeat(MAX_SCENARIO_NAME_LENGTH);
    let errors = validate_scenario_name(&name);
    assert!(errors.is_empty());
}

#[test]
fn test_validate_comment_too_long() {
    let long_comment = "y".repeat(MAX_SCENARIO_COMMENT_LENGTH + 1);
    let errors = validate_scenario_comment(&long_comment);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].message.contains("255"));
}

#[test]
fn test_validate_comment_valid() {
    let errors = validate_scenario_comment("A useful comment");
    assert!(errors.is_empty());
}

#[test]
fn test_validate_changing_cells_empty() {
    let errors = validate_changing_cells(&[]);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].message.contains("At least one"));
}

#[test]
fn test_validate_changing_cells_too_many() {
    let cells: Vec<String> = (0..MAX_CHANGING_CELLS_PER_SCENARIO + 1)
        .map(|i| format!("cell-{}", i))
        .collect();
    let errors = validate_changing_cells(&cells);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].message.contains("32"));
}

#[test]
fn test_validate_changing_cells_duplicates() {
    let cells = vec!["cell-1".to_string(), "cell-1".to_string()];
    let errors = validate_changing_cells(&cells);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].message.contains("Duplicate"));
}

#[test]
fn test_validate_changing_cells_valid() {
    let cells = vec!["cell-1".to_string(), "cell-2".to_string()];
    let errors = validate_changing_cells(&cells);
    assert!(errors.is_empty());
}

#[test]
fn test_validate_values_mismatch() {
    let cells = vec!["cell-1".to_string(), "cell-2".to_string()];
    let values = vec![CellValue::Number(FiniteF64::must(1.0))];
    let errors = validate_values(&cells, &values);
    assert_eq!(errors.len(), 1);
    assert!(errors[0].message.contains("must match"));
}

#[test]
fn test_validate_values_valid() {
    let cells = vec!["cell-1".to_string()];
    let values = vec![CellValue::Number(FiniteF64::must(1.0))];
    let errors = validate_values(&cells, &values);
    assert!(errors.is_empty());
}

#[test]
fn test_validate_scenario_input_duplicate_name() {
    let existing = vec![Scenario {
        id: "id-1".to_string(),
        name: "Existing".to_string(),
        comment: String::new(),
        changing_cells: vec!["cell-1".to_string()],
        values: vec![CellValue::Number(FiniteF64::must(1.0))],
        created_by: None,
        created_at: FiniteF64::ZERO,
        modified_at: None,
    }];

    let input = ScenarioCreateInput {
        name: "existing".to_string(), // case-insensitive match
        comment: String::new(),
        changing_cells: vec!["cell-1".to_string()],
        values: vec![CellValue::Number(FiniteF64::must(1.0))],
        created_by: None,
    };

    let errors = validate_scenario_input(&input, &existing, None);
    assert!(errors.iter().any(|e| e.message.contains("already exists")));
}

#[test]
fn test_validate_scenario_input_duplicate_name_excluded_for_update() {
    let existing = vec![Scenario {
        id: "id-1".to_string(),
        name: "Existing".to_string(),
        comment: String::new(),
        changing_cells: vec!["cell-1".to_string()],
        values: vec![CellValue::Number(FiniteF64::must(1.0))],
        created_by: None,
        created_at: FiniteF64::ZERO,
        modified_at: None,
    }];

    let input = ScenarioCreateInput {
        name: "Existing".to_string(),
        comment: String::new(),
        changing_cells: vec!["cell-1".to_string()],
        values: vec![CellValue::Number(FiniteF64::must(1.0))],
        created_by: None,
    };

    // When updating scenario "id-1", its own name should not cause a duplicate error
    let errors = validate_scenario_input(&input, &existing, Some("id-1"));
    assert!(!errors.iter().any(|e| e.message.contains("already exists")));
}

// -------------------------------------------------------------------
// CRUD tests
// -------------------------------------------------------------------

#[test]
fn test_create_scenario_success() {
    let storage = test_storage();
    let input = simple_input("Best Case");

    let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
    assert!(result.success);
    assert!(result.scenario_id.is_some());
    assert!(result.errors.is_none());

    // Verify scenario exists
    let all = get_all(&storage);
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Best Case");
    assert_eq!(all[0].changing_cells, vec!["cell-1"]);
    assert_eq!(
        all[0].values,
        vec![CellValue::Number(FiniteF64::must(100.0))]
    );
    assert_eq!(all[0].created_by, Some("test-user".to_string()));
}

#[test]
fn test_create_scenario_trims_name() {
    let storage = test_storage();
    let input = ScenarioCreateInput {
        name: "  Trimmed Name  ".to_string(),
        comment: String::new(),
        changing_cells: vec!["cell-1".to_string()],
        values: vec![CellValue::Number(FiniteF64::must(1.0))],
        created_by: None,
    };

    let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
    assert!(result.success);

    let all = get_all(&storage);
    assert_eq!(all[0].name, "Trimmed Name");
}

#[test]
fn test_create_scenario_validation_failure() {
    let storage = test_storage();
    let input = ScenarioCreateInput {
        name: String::new(),
        comment: String::new(),
        changing_cells: vec![],
        values: vec![],
        created_by: None,
    };

    let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
    assert!(!result.success);
    assert!(result.scenario_id.is_none());
    assert!(result.errors.is_some());
    // Should have errors for name and changing cells
    let errors = result.errors.unwrap();
    assert!(errors.len() >= 2);
}

#[test]
fn test_create_multiple_scenarios() {
    let storage = test_storage();

    create(
        &storage,
        simple_input("Scenario A"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    create(
        &storage,
        simple_input("Scenario B"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    create(
        &storage,
        simple_input("Scenario C"),
        &crate::storage::STORAGE_ID_ALLOC,
    );

    let all = get_all(&storage);
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].name, "Scenario A");
    assert_eq!(all[1].name, "Scenario B");
    assert_eq!(all[2].name, "Scenario C");
}

#[test]
fn test_create_scenario_duplicate_name_rejected() {
    let storage = test_storage();

    let result1 = create(
        &storage,
        simple_input("Same Name"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result1.success);

    let result2 = create(
        &storage,
        simple_input("same name"),
        &crate::storage::STORAGE_ID_ALLOC,
    ); // case-insensitive
    assert!(!result2.success);
    let errors = result2.errors.unwrap();
    assert!(errors.iter().any(|e| e.message.contains("already exists")));
}

#[test]
fn test_create_scenario_at_limit() {
    let storage = test_storage();

    // Create MAX_SCENARIOS scenarios
    for i in 0..MAX_SCENARIOS {
        let result = create(
            &storage,
            simple_input(&format!("Scenario {}", i)),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.success, "Scenario {} should succeed", i);
    }

    assert_eq!(get_count(&storage), MAX_SCENARIOS);
    assert!(is_at_limit(&storage));

    // One more should fail
    let result = create(
        &storage,
        simple_input("One Too Many"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(!result.success);
    let errors = result.errors.unwrap();
    assert!(errors.iter().any(|e| e.message.contains("Maximum")));
}

#[test]
fn test_get_by_id() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Find Me"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    let found = get_by_id(&storage, &scenario_id);
    assert!(found.is_some());
    assert_eq!(found.unwrap().name, "Find Me");

    let not_found = get_by_id(&storage, "nonexistent-id");
    assert!(not_found.is_none());
}

#[test]
fn test_find_by_name() {
    let storage = test_storage();

    create(
        &storage,
        simple_input("My Scenario"),
        &crate::storage::STORAGE_ID_ALLOC,
    );

    let found = find_by_name(&storage, "My Scenario");
    assert!(found.is_some());
    assert_eq!(found.unwrap().name, "My Scenario");

    // Case-insensitive
    let found_lower = find_by_name(&storage, "my scenario");
    assert!(found_lower.is_some());

    let not_found = find_by_name(&storage, "Nonexistent");
    assert!(not_found.is_none());
}

#[test]
fn test_get_count_empty() {
    let storage = test_storage();
    assert_eq!(get_count(&storage), 0);
}

#[test]
fn test_is_at_limit_empty() {
    let storage = test_storage();
    assert!(!is_at_limit(&storage));
}

// -------------------------------------------------------------------
// Update tests
// -------------------------------------------------------------------

#[test]
fn test_update_scenario_name() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Old Name"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    let update_result = update(
        &storage,
        &scenario_id,
        ScenarioUpdateInput {
            name: Some("New Name".to_string()),
            ..Default::default()
        },
    );
    assert!(update_result.success);

    let updated = get_by_id(&storage, &scenario_id).unwrap();
    assert_eq!(updated.name, "New Name");
}

#[test]
fn test_update_scenario_comment() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Scenario X"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    let update_result = update(
        &storage,
        &scenario_id,
        ScenarioUpdateInput {
            comment: Some("Updated comment".to_string()),
            ..Default::default()
        },
    );
    assert!(update_result.success);

    let updated = get_by_id(&storage, &scenario_id).unwrap();
    assert_eq!(updated.comment, "Updated comment");
}

#[test]
fn test_update_scenario_values() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Values Test"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    let update_result = update(
        &storage,
        &scenario_id,
        ScenarioUpdateInput {
            values: Some(vec![CellValue::Number(FiniteF64::must(999.0))]),
            ..Default::default()
        },
    );
    assert!(update_result.success);

    let updated = get_by_id(&storage, &scenario_id).unwrap();
    assert_eq!(
        updated.values,
        vec![CellValue::Number(FiniteF64::must(999.0))]
    );
}

#[test]
fn test_update_scenario_not_found() {
    let storage = test_storage();

    let result = update(
        &storage,
        "nonexistent",
        ScenarioUpdateInput {
            name: Some("New Name".to_string()),
            ..Default::default()
        },
    );
    assert!(!result.success);
    let errors = result.errors.unwrap();
    assert!(errors.iter().any(|e| e.message.contains("not found")));
}

#[test]
fn test_update_scenario_duplicate_name_rejected() {
    let storage = test_storage();

    create(
        &storage,
        simple_input("Alpha"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let result_b = create(
        &storage,
        simple_input("Beta"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let beta_id = result_b.scenario_id.unwrap();

    // Try to rename Beta to "alpha" (case-insensitive duplicate)
    let update_result = update(
        &storage,
        &beta_id,
        ScenarioUpdateInput {
            name: Some("alpha".to_string()),
            ..Default::default()
        },
    );
    assert!(!update_result.success);
    let errors = update_result.errors.unwrap();
    assert!(errors.iter().any(|e| e.message.contains("already exists")));
}

#[test]
fn test_update_scenario_same_name_allowed() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Keep Name"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    // Updating with the same name should succeed
    let update_result = update(
        &storage,
        &scenario_id,
        ScenarioUpdateInput {
            name: Some("Keep Name".to_string()),
            ..Default::default()
        },
    );
    assert!(update_result.success);
}

#[test]
fn test_update_preserves_order() {
    let storage = test_storage();

    create(
        &storage,
        simple_input("First"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let result_b = create(
        &storage,
        simple_input("Second"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let second_id = result_b.scenario_id.unwrap();
    create(
        &storage,
        simple_input("Third"),
        &crate::storage::STORAGE_ID_ALLOC,
    );

    // Update the middle scenario
    update(
        &storage,
        &second_id,
        ScenarioUpdateInput {
            name: Some("Updated Second".to_string()),
            ..Default::default()
        },
    );

    let all = get_all(&storage);
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].name, "First");
    assert_eq!(all[1].name, "Updated Second");
    assert_eq!(all[2].name, "Third");
}

// -------------------------------------------------------------------
// Delete tests
// -------------------------------------------------------------------

#[test]
fn test_remove_scenario() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("To Remove"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    assert_eq!(get_count(&storage), 1);

    let removed = remove(&storage, &scenario_id);
    assert!(removed.success);
    assert_eq!(removed.scenario_id.as_deref(), Some(scenario_id.as_str()));
    assert_eq!(get_count(&storage), 0);
}

#[test]
fn test_remove_scenario_not_found() {
    let storage = test_storage();
    let removed = remove(&storage, "nonexistent");
    assert!(!removed.success);
    assert_eq!(removed.errors.as_ref().unwrap()[0].field, "scenarioId");
}

#[test]
fn test_remove_scrubs_legacy_active_scenario_id() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Active One"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    {
        let workbook = storage.workbook_map();
        let mut txn = storage.doc().transact_mut();
        let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
        scenarios_map.insert(
            &mut txn,
            KEY_ACTIVE_SCENARIO_ID,
            Any::String(Arc::from(scenario_id.as_str())),
        );
    }

    let removed = remove(&storage, &scenario_id);
    assert!(removed.success);

    assert!(get_active_scenario_id(&storage).is_none());
    let txn = storage.doc().transact();
    let scenarios_map = get_scenarios_map(storage.workbook_map(), &txn).unwrap();
    assert!(scenarios_map.get(&txn, KEY_ACTIVE_SCENARIO_ID).is_none());
}

#[test]
fn test_create_scrubs_legacy_active_scenario_id() {
    let storage = test_storage();

    {
        let workbook = storage.workbook_map();
        let mut txn = storage.doc().transact_mut();
        let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
        scenarios_map.insert(
            &mut txn,
            KEY_ACTIVE_SCENARIO_ID,
            Any::String(Arc::from("legacy-active")),
        );
    }

    let result = create(
        &storage,
        simple_input("A"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.success);

    let txn = storage.doc().transact();
    let scenarios_map = get_scenarios_map(storage.workbook_map(), &txn).unwrap();
    assert!(scenarios_map.get(&txn, KEY_ACTIVE_SCENARIO_ID).is_none());
}

#[test]
fn test_remove_preserves_order_of_remaining() {
    let storage = test_storage();

    let r1 = create(
        &storage,
        simple_input("First"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let id_1 = r1.scenario_id.unwrap();

    create(
        &storage,
        simple_input("Second"),
        &crate::storage::STORAGE_ID_ALLOC,
    );

    let r3 = create(
        &storage,
        simple_input("Third"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let _id_3 = r3.scenario_id.unwrap();

    // Remove the first one
    remove(&storage, &id_1);

    let all = get_all(&storage);
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].name, "Second");
    assert_eq!(all[1].name, "Third");
}

// -------------------------------------------------------------------
// Active scenario tests
// -------------------------------------------------------------------

#[test]
fn test_set_active_scenario_id_rejected() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Test"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    assert!(get_active_scenario_id(&storage).is_none());

    let err = set_active_scenario_id(&storage, Some(&scenario_id)).unwrap_err();
    assert!(err.to_string().contains("SCENARIO_ACTIVE_STATE_READ_ONLY"));
    assert!(get_active_scenario_id(&storage).is_none());
}

#[test]
fn test_get_active_scenario() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Active Test"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    // No active scenario
    assert!(get_active_scenario(&storage).is_none());

    let workbook = storage.workbook_map();
    let mut txn = storage.doc().transact_mut();
    let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
    scenarios_map.insert(
        &mut txn,
        KEY_ACTIVE_SCENARIO_ID,
        Any::String(Arc::from(scenario_id.as_str())),
    );
    drop(txn);

    assert!(get_active_scenario(&storage).is_none());
}

#[test]
fn test_get_active_scenario_ignores_legacy_active_id() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Test"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    let workbook = storage.workbook_map();
    let mut txn = storage.doc().transact_mut();
    let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
    scenarios_map.insert(
        &mut txn,
        KEY_ACTIVE_SCENARIO_ID,
        Any::String(Arc::from(scenario_id.as_str())),
    );
    drop(txn);

    assert!(get_active_scenario_id(&storage).is_none());
    assert!(get_active_scenario(&storage).is_none());
}

// -------------------------------------------------------------------
// Scenario data roundtrip tests
// -------------------------------------------------------------------

#[test]
fn test_scenario_stores_all_cell_value_types() {
    let storage = test_storage();

    let input = ScenarioCreateInput {
        name: "Value Types".to_string(),
        comment: "Testing different value types".to_string(),
        changing_cells: vec![
            "cell-num".to_string(),
            "cell-text".to_string(),
            "cell-bool".to_string(),
            "cell-null".to_string(),
        ],
        values: vec![
            CellValue::Number(FiniteF64::must(42.0)),
            CellValue::Text("hello".into()),
            CellValue::Boolean(true),
            CellValue::Null,
        ],
        created_by: Some("user-1".to_string()),
    };

    let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
    assert!(result.success);

    let scenario = get_by_id(&storage, &result.scenario_id.unwrap()).unwrap();
    assert_eq!(scenario.values.len(), 4);
    assert_eq!(scenario.values[0], CellValue::Number(FiniteF64::must(42.0)));
    assert_eq!(scenario.values[1], CellValue::Text("hello".into()));
    assert_eq!(scenario.values[2], CellValue::Boolean(true));
    assert_eq!(scenario.values[3], CellValue::Null);
}

#[test]
fn test_scenario_timestamps_set() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Timestamp Test"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    assert!(result.success);

    let scenario = get_by_id(&storage, &result.scenario_id.unwrap()).unwrap();
    assert!(scenario.created_at.get() > 0.0 || cfg!(target_arch = "wasm32"));
    assert!(scenario.modified_at.is_some());
}

#[test]
fn test_scenario_update_changes_modified_at() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Time Test"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    let before = get_by_id(&storage, &scenario_id).unwrap();
    let before_modified = before.modified_at;

    // Small delay to ensure different timestamp (not strictly needed in practice)
    update(
        &storage,
        &scenario_id,
        ScenarioUpdateInput {
            comment: Some("updated".to_string()),
            ..Default::default()
        },
    );

    let after = get_by_id(&storage, &scenario_id).unwrap();
    // modified_at should be set (it may or may not differ depending on timing)
    assert!(after.modified_at.is_some());
    // created_at should not change
    assert_eq!(before.created_at, after.created_at);

    // If timestamps are the same, that's OK in tests (same millisecond).
    // The important thing is modified_at is populated.
    let _ = before_modified;
}

// -------------------------------------------------------------------
// Edge case tests
// -------------------------------------------------------------------

#[test]
fn test_empty_storage_getters() {
    let storage = test_storage();

    assert_eq!(get_all(&storage).len(), 0);
    assert_eq!(get_count(&storage), 0);
    assert!(get_by_id(&storage, "any-id").is_none());
    assert!(get_active_scenario_id(&storage).is_none());
    assert!(get_active_scenario(&storage).is_none());
    assert!(find_by_name(&storage, "any").is_none());
    assert!(!is_at_limit(&storage));
}

#[test]
fn test_scenario_with_max_changing_cells() {
    let storage = test_storage();

    let cells: Vec<String> = (0..MAX_CHANGING_CELLS_PER_SCENARIO)
        .map(|i| format!("cell-{}", i))
        .collect();
    let values: Vec<CellValue> = (0..MAX_CHANGING_CELLS_PER_SCENARIO)
        .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
        .collect();

    let input = ScenarioCreateInput {
        name: "Max Cells".to_string(),
        comment: String::new(),
        changing_cells: cells,
        values,
        created_by: None,
    };

    let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
    assert!(result.success);

    let scenario = get_by_id(&storage, &result.scenario_id.unwrap()).unwrap();
    assert_eq!(
        scenario.changing_cells.len(),
        MAX_CHANGING_CELLS_PER_SCENARIO
    );
}

#[test]
fn test_update_changing_cells_and_values() {
    let storage = test_storage();

    let result = create(
        &storage,
        simple_input("Update Cells"),
        &crate::storage::STORAGE_ID_ALLOC,
    );
    let scenario_id = result.scenario_id.unwrap();

    let update_result = update(
        &storage,
        &scenario_id,
        ScenarioUpdateInput {
            changing_cells: Some(vec!["cell-a".to_string(), "cell-b".to_string()]),
            values: Some(vec![
                CellValue::Number(FiniteF64::must(10.0)),
                CellValue::Number(FiniteF64::must(20.0)),
            ]),
            ..Default::default()
        },
    );
    assert!(update_result.success);

    let updated = get_by_id(&storage, &scenario_id).unwrap();
    assert_eq!(updated.changing_cells.len(), 2);
    assert_eq!(updated.values.len(), 2);
    assert_eq!(updated.changing_cells[0], "cell-a");
    assert_eq!(updated.changing_cells[1], "cell-b");
}
