use super::super::full_parse_result_to_parse_output;
use super::helpers::threading_result;
use crate::output::results::{FullParsedSheet, ProtectionOutput};

#[test]
fn sheet_protection_modern_hash_fields_reach_parse_output() {
    let result = threading_result(
        FullParsedSheet {
            name: "Protected".to_string(),
            protection: Some(ProtectionOutput {
                password: Some("CC2A".to_string()),
                algorithm_name: Some("SHA-512".to_string()),
                hash_value: Some("modernHash==".to_string()),
                salt_value: Some("modernSalt==".to_string()),
                spin_count: Some(100000),
                sheet: true,
                objects: true,
                scenarios: false,
                format_cells: true,
                format_columns: false,
                format_rows: false,
                insert_columns: true,
                insert_rows: true,
                insert_hyperlinks: false,
                delete_columns: true,
                delete_rows: false,
                sort: true,
                auto_filter: false,
                pivot_tables: true,
                select_locked_cells: false,
                select_unlocked_cells: true,
            }),
            ..Default::default()
        },
        None,
        Vec::new(),
    );

    let (output, _) = full_parse_result_to_parse_output(&result);
    let protection = output.sheets[0]
        .protection
        .as_ref()
        .expect("sheet protection should be converted");

    assert_eq!(protection.password_hash.as_deref(), Some("CC2A"));
    assert_eq!(protection.algorithm_name.as_deref(), Some("SHA-512"));
    assert_eq!(protection.hash_value.as_deref(), Some("modernHash=="));
    assert_eq!(protection.salt_value.as_deref(), Some("modernSalt=="));
    assert_eq!(protection.spin_count, Some(100000));
    assert!(protection.is_protected);
}
