use std::sync::Arc;

use super::helpers::*;
use domain_types::{
    CFCellRange, CFRule, CFStyle, Comment, CommentType, ConditionalFormat, ErrorStyle,
    TableColumnSpec, TableSpec, ValidationOperator, ValidationRule, ValidationSpec,
};
use ooxml_types::cond_format::CfOperator;
use value_types::{CellValue, FiniteF64};

/// Helper: build a "rich" baseline ParseOutput that has data in multiple domains.
/// Used by field-independence tests so we can mutate one field and verify the rest.
fn make_rich_baseline() -> domain_types::ParseOutput {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Name"))),
            cell(0, 1, CellValue::Text(Arc::from("Value"))),
            cell(1, 0, CellValue::Text(Arc::from("Alice"))),
            cell(1, 1, CellValue::Number(FiniteF64::new(100.0).unwrap())),
            cell(2, 0, CellValue::Text(Arc::from("Bob"))),
            cell(2, 1, CellValue::Number(FiniteF64::new(200.0).unwrap())),
        ],
    );
    output.sheets[0].rows = 5;
    output.sheets[0].cols = 3;

    // Comments on two cells
    output.sheets[0].comments = vec![
        Comment {
            cell_ref: "A1".to_string(),
            author: "Author1".to_string(),
            content: Some("Original comment on A1".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        },
        Comment {
            cell_ref: "B2".to_string(),
            author: "Author2".to_string(),
            content: Some("Original comment on B2".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        },
    ];

    // Two CF rules with different rule types
    output.sheets[0].conditional_formats = vec![ConditionalFormat {
        id: "test-cf-rich".to_string(),
        sheet_id: String::new(),
        pivot: None,
        ranges: vec![CFCellRange::new(1, 1, 2, 1)], // B2:B3
        range_identities: None,
        rules: vec![
            CFRule::CellValue {
                id: "test-rule-rich-1".to_string(),
                operator: CfOperator::GreaterThan,
                value1: serde_json::Value::String("50".to_string()),
                value2: None,
                style: CFStyle::default(),
                priority: 1,
                stop_if_true: None,
                text: None,
            },
            CFRule::CellValue {
                id: "test-rule-rich-2".to_string(),
                operator: CfOperator::LessThan,
                value1: serde_json::Value::String("10".to_string()),
                value2: None,
                style: CFStyle::default(),
                priority: 2,
                stop_if_true: None,
                text: None,
            },
        ],
    }];

    // Data validations
    output.sheets[0].data_validations = vec![ValidationSpec {
        ranges: vec!["B2:B3".to_string()],
        rule: ValidationRule::WholeNumber {
            operator: ValidationOperator::Between,
            formula1: "1".to_string(),
            formula2: Some("500".to_string()),
        },
        error_style: ErrorStyle::Stop,
        show_error: true,
        error_title: Some("Invalid".to_string()),
        error_message: Some("Enter 1-500".to_string()),
        show_prompt: true,
        prompt_title: Some("Input".to_string()),
        prompt_message: Some("Enter a whole number".to_string()),
        allow_blank: true,
        ime_mode: domain_types::ImeMode::NoControl,
        uid: None,
    }];

    // Table
    output.sheets[0].tables = vec![TableSpec {
        id: 1,
        name: "Table1".to_string(),
        display_name: "Table1".to_string(),
        range_ref: "A1:B3".to_string(),
        has_headers: true,
        has_totals: false,
        style_name: Some("TableStyleMedium2".to_string()),
        row_stripes: true,
        col_stripes: false,
        first_col_highlight: false,
        last_col_highlight: false,
        auto_filter_ref: Some("A1:B3".to_string()),
        columns: vec![
            TableColumnSpec {
                name: "Name".to_string(),
                ..Default::default()
            },
            TableColumnSpec {
                name: "Value".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    }];

    output
}

/// Round-trip the baseline once and return it, so tests can compare against
/// a known-good round-tripped version rather than the raw original (which may
/// have normalization differences).
fn baseline_roundtripped() -> domain_types::ParseOutput {
    roundtrip(&make_rich_baseline())
}

#[test]
fn field_independence_modify_comment_content() {
    // Mutate: change the content of one comment.
    // Verify: only that comment's content changed; the other comment, CF rules,
    //         validations, tables, and cells are all identical.
    let mut modified = make_rich_baseline();
    modified.sheets[0].comments[0].content = Some("MODIFIED comment on A1".to_string());

    let rt_baseline = baseline_roundtripped();
    let rt_modified = roundtrip(&modified);

    // The modified comment should have new content
    let mod_comments: std::collections::HashMap<&str, &Comment> = rt_modified.sheets[0]
        .comments
        .iter()
        .map(|c| (c.cell_ref.as_str(), c))
        .collect();
    let base_comments: std::collections::HashMap<&str, &Comment> = rt_baseline.sheets[0]
        .comments
        .iter()
        .map(|c| (c.cell_ref.as_str(), c))
        .collect();

    // A1 comment should differ
    let mod_a1 = mod_comments
        .get("A1")
        .expect("Modified A1 comment should exist");
    let mod_a1_text = mod_a1.content.as_deref().unwrap_or_else(|| {
        if !mod_a1.runs.is_empty() {
            "has_runs"
        } else {
            ""
        }
    });
    assert!(
        mod_a1_text.contains("MODIFIED") || mod_a1.runs.iter().any(|r| r.text.contains("MODIFIED")),
        "A1 comment should contain modified text. Got content={:?}, runs={:?}",
        mod_a1.content,
        mod_a1.runs
    );

    // B2 comment should be unchanged
    if let (Some(base_b2), Some(mod_b2)) = (base_comments.get("B2"), mod_comments.get("B2")) {
        assert_eq!(
            base_b2.author, mod_b2.author,
            "B2 comment author should be unchanged"
        );
        assert_eq!(
            base_b2.content, mod_b2.content,
            "B2 comment content should be unchanged"
        );
    }

    // Cells should be identical
    assert_cells_match(
        &rt_baseline.sheets[0].cells,
        &rt_modified.sheets[0].cells,
        "field_independence_comment",
    );

    // CF rules should be identical
    assert_eq!(
        rt_baseline.sheets[0].conditional_formats.len(),
        rt_modified.sheets[0].conditional_formats.len(),
        "CF count should be unchanged after comment modification"
    );

    // Tables should be identical
    assert_eq!(
        rt_baseline.sheets[0].tables.len(),
        rt_modified.sheets[0].tables.len(),
        "Table count should be unchanged after comment modification"
    );
    if !rt_baseline.sheets[0].tables.is_empty() && !rt_modified.sheets[0].tables.is_empty() {
        assert_eq!(
            rt_baseline.sheets[0].tables[0].name, rt_modified.sheets[0].tables[0].name,
            "Table name should be unchanged after comment modification"
        );
        assert_eq!(
            rt_baseline.sheets[0].tables[0].columns.len(),
            rt_modified.sheets[0].tables[0].columns.len(),
            "Table columns should be unchanged after comment modification"
        );
    }
}

#[test]
fn field_independence_modify_cf_priority() {
    // Mutate: change the priority of the first CF rule.
    // Verify: the second rule and all other domains are unchanged.
    let mut modified = make_rich_baseline();
    // Change priority of first rule from 1 to 99
    if let CFRule::CellValue {
        ref mut priority, ..
    } = modified.sheets[0].conditional_formats[0].rules[0]
    {
        *priority = 99;
    }

    let rt_baseline = baseline_roundtripped();
    let rt_modified = roundtrip(&modified);

    // CF rules should still exist
    assert!(
        !rt_modified.sheets[0].conditional_formats.is_empty(),
        "CF specs should survive after priority change"
    );

    let rt_cf = &rt_modified.sheets[0].conditional_formats[0];

    // Find the rule with modified priority
    let has_priority_99 = rt_cf.rules.iter().any(|r| match r {
        CFRule::CellValue { priority, .. } => *priority == 99,
        _ => false,
    });
    assert!(
        has_priority_99,
        "Should find CF rule with priority=99 after modification. Got: {:?}",
        rt_cf.rules
    );

    // The second rule (priority=2) should still exist
    let has_priority_2 = rt_cf.rules.iter().any(|r| match r {
        CFRule::CellValue { priority, .. } => *priority == 2,
        _ => false,
    });
    assert!(
        has_priority_2,
        "Second CF rule (priority=2) should be unchanged. Got: {:?}",
        rt_cf.rules
    );

    // Comments should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].comments.len(),
        rt_modified.sheets[0].comments.len(),
        "Comment count should be unchanged after CF priority change"
    );

    // Cells should be identical
    assert_cells_match(
        &rt_baseline.sheets[0].cells,
        &rt_modified.sheets[0].cells,
        "field_independence_cf_priority",
    );

    // Validations should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].data_validations.len(),
        rt_modified.sheets[0].data_validations.len(),
        "Validation count should be unchanged after CF priority change"
    );

    // Tables should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].tables.len(),
        rt_modified.sheets[0].tables.len(),
        "Table count should be unchanged after CF priority change"
    );
}

#[test]
fn field_independence_modify_validation_message() {
    // Mutate: change only the error_message on a validation.
    // Verify: the rule type, ranges, and other domains are unchanged.
    let mut modified = make_rich_baseline();
    modified.sheets[0].data_validations[0].error_message =
        Some("MODIFIED: must be 1-500".to_string());

    let rt_baseline = baseline_roundtripped();
    let rt_modified = roundtrip(&modified);

    // Validation should survive
    assert!(
        !rt_modified.sheets[0].data_validations.is_empty(),
        "Validations should survive after message modification"
    );

    let dv = &rt_modified.sheets[0].data_validations[0];

    // Error message should reflect the change
    assert_eq!(
        dv.error_message.as_deref(),
        Some("MODIFIED: must be 1-500"),
        "Error message should be updated"
    );

    // Rule type should be unchanged (still WholeNumber/between)
    match &dv.rule {
        ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => {
            assert_eq!(
                *operator,
                ValidationOperator::Between,
                "Operator should be unchanged"
            );
            assert_eq!(formula1, "1", "Formula1 should be unchanged");
            assert_eq!(
                formula2.as_deref(),
                Some("500"),
                "Formula2 should be unchanged"
            );
        }
        other => panic!("Expected WholeNumber rule unchanged, got {:?}", other),
    }

    // Other fields on the validation should be unchanged
    assert_eq!(
        dv.error_title.as_deref(),
        Some("Invalid"),
        "Error title should be unchanged"
    );
    assert_eq!(
        dv.prompt_message.as_deref(),
        Some("Enter a whole number"),
        "Prompt message should be unchanged"
    );

    // Comments should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].comments.len(),
        rt_modified.sheets[0].comments.len(),
        "Comment count should be unchanged after validation message change"
    );

    // Cells should be identical
    assert_cells_match(
        &rt_baseline.sheets[0].cells,
        &rt_modified.sheets[0].cells,
        "field_independence_validation_msg",
    );

    // CF rules should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].conditional_formats.len(),
        rt_modified.sheets[0].conditional_formats.len(),
        "CF count should be unchanged after validation message change"
    );
}

#[test]
fn field_independence_modify_table_display_name() {
    // Mutate: change a table's display_name.
    // Verify: the table's columns are unchanged, and other domains are unchanged.
    let mut modified = make_rich_baseline();
    modified.sheets[0].tables[0].display_name = "RenamedTable".to_string();

    let rt_baseline = baseline_roundtripped();
    let rt_modified = roundtrip(&modified);

    // Table should survive
    assert!(
        !rt_modified.sheets[0].tables.is_empty(),
        "Tables should survive after display_name change"
    );

    let t = &rt_modified.sheets[0].tables[0];

    // Display name should be updated
    assert_eq!(
        t.display_name, "RenamedTable",
        "Display name should be updated"
    );

    // Columns should be unchanged
    assert_eq!(t.columns.len(), 2, "Table should still have 2 columns");
    assert_eq!(t.columns[0].name, "Name", "First column name unchanged");
    assert_eq!(t.columns[1].name, "Value", "Second column name unchanged");

    // Range ref should be unchanged
    assert_eq!(t.range_ref, "A1:B3", "Range ref should be unchanged");

    // has_headers should be unchanged
    assert!(t.has_headers, "has_headers should be unchanged");

    // Comments should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].comments.len(),
        rt_modified.sheets[0].comments.len(),
        "Comment count should be unchanged after table display_name change"
    );

    // Cells should be identical
    assert_cells_match(
        &rt_baseline.sheets[0].cells,
        &rt_modified.sheets[0].cells,
        "field_independence_table_display_name",
    );

    // CF rules should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].conditional_formats.len(),
        rt_modified.sheets[0].conditional_formats.len(),
        "CF count should be unchanged after table display_name change"
    );

    // Validations should be unchanged
    assert_eq!(
        rt_baseline.sheets[0].data_validations.len(),
        rt_modified.sheets[0].data_validations.len(),
        "Validation count should be unchanged after table display_name change"
    );
}
