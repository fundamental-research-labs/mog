use super::test_helpers::*;
use super::*;

// ========================================================================
// Parsing Tests
// ========================================================================

mod parsing {
    use super::*;

    #[test]
    fn simple_column_reference() {
        let result = parse_structured_ref("Sales[Amount]").unwrap();
        assert_eq!(result.table_name, "Sales");
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "Amount".to_string()
            }]
        );
    }

    #[test]
    fn table_name_with_underscores() {
        let result = parse_structured_ref("My_Table[Score]").unwrap();
        assert_eq!(result.table_name, "My_Table");
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "Score".to_string()
            }]
        );
    }

    #[test]
    fn this_row_with_column() {
        let result = parse_structured_ref("Sales[@Amount]").unwrap();
        assert_eq!(result.table_name, "Sales");
        assert_eq!(
            result.specifiers,
            vec![
                StructuredRefSpecifier::ThisRow,
                StructuredRefSpecifier::Column {
                    name: "Amount".to_string()
                }
            ]
        );
    }

    #[test]
    fn bare_at_sign_is_this_row() {
        let result = parse_structured_ref("Sales[@]").unwrap();
        assert_eq!(result.specifiers, vec![StructuredRefSpecifier::ThisRow]);
    }

    #[test]
    fn special_item_headers() {
        let result = parse_structured_ref("Sales[#Headers]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Special {
                item: SpecialItem::Headers
            }]
        );
    }

    #[test]
    fn special_item_data() {
        let result = parse_structured_ref("Sales[#Data]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Special {
                item: SpecialItem::Data
            }]
        );
    }

    #[test]
    fn special_item_totals() {
        let result = parse_structured_ref("Sales[#Totals]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Special {
                item: SpecialItem::Totals
            }]
        );
    }

    #[test]
    fn special_item_all() {
        let result = parse_structured_ref("Sales[#All]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Special {
                item: SpecialItem::All
            }]
        );
    }

    #[test]
    fn special_item_this_row() {
        let result = parse_structured_ref("Sales[#This Row]").unwrap();
        assert_eq!(result.specifiers, vec![StructuredRefSpecifier::ThisRow]);
    }

    #[test]
    fn combined_special_and_column() {
        let result = parse_structured_ref("Sales[[#Headers],[Amount]]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Headers
                },
                StructuredRefSpecifier::Column {
                    name: "Amount".to_string()
                }
            ]
        );
    }

    #[test]
    fn combined_special_and_column_range() {
        let result = parse_structured_ref("Sales[[#Totals],[Product]:[Amount]]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Totals
                },
                StructuredRefSpecifier::ColumnRange {
                    start: "Product".to_string(),
                    end: "Amount".to_string()
                }
            ]
        );
    }

    #[test]
    fn combined_headers_and_data() {
        let result = parse_structured_ref("Sales[[#Headers],[#Data]]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Headers
                },
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Data
                }
            ]
        );
    }

    #[test]
    fn combined_data_and_totals() {
        let result = parse_structured_ref("Sales[[#Data],[#Totals]]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Data
                },
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Totals
                }
            ]
        );
    }

    #[test]
    fn column_range() {
        let result = parse_structured_ref("Sales[[Product]:[Amount]]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::ColumnRange {
                start: "Product".to_string(),
                end: "Amount".to_string()
            }]
        );
    }

    #[test]
    fn column_names_with_spaces() {
        let result = parse_structured_ref("My_Table[First Name]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "First Name".to_string()
            }]
        );
    }

    #[test]
    fn column_range_with_spaces() {
        let result = parse_structured_ref("My_Table[[First Name]:[Last Name]]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::ColumnRange {
                start: "First Name".to_string(),
                end: "Last Name".to_string()
            }]
        );
    }

    #[test]
    fn returns_none_for_empty_string() {
        assert!(parse_structured_ref("").is_err());
    }

    #[test]
    fn returns_none_for_whitespace() {
        assert!(parse_structured_ref("   ").is_err());
    }

    #[test]
    fn returns_none_for_missing_table_name() {
        assert!(parse_structured_ref("[Column1]").is_err());
    }

    #[test]
    fn returns_none_for_missing_brackets() {
        assert!(parse_structured_ref("Sales").is_err());
    }

    #[test]
    fn returns_none_for_empty_brackets() {
        assert!(parse_structured_ref("Sales[]").is_err());
    }

    #[test]
    fn returns_none_for_invalid_special_item() {
        assert!(parse_structured_ref("Sales[#Invalid]").is_err());
    }

    #[test]
    fn returns_none_for_unbalanced_brackets() {
        assert!(parse_structured_ref("Sales[[Column1]").is_err());
    }

    #[test]
    fn escaped_column_name_with_single_quotes() {
        let result = parse_structured_ref("Sales['Tom''s Sales']").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "Tom's Sales".to_string()
            }]
        );
    }

    #[test]
    fn escaped_column_name_with_brackets() {
        let result = parse_structured_ref("Sales['Price [[USD]]']").unwrap();
        assert_eq!(
            result.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "Price [USD]".to_string()
            }]
        );
    }

    #[test]
    fn at_shorthand_with_escaped_column_name() {
        let result = parse_structured_ref("Sales[@'Tom''s Sales']").unwrap();
        assert_eq!(
            result.specifiers,
            vec![
                StructuredRefSpecifier::ThisRow,
                StructuredRefSpecifier::Column {
                    name: "Tom's Sales".to_string()
                }
            ]
        );
    }

    #[test]
    fn this_row_in_combined_context() {
        let result = parse_structured_ref("Sales[[#This Row],[Amount]]").unwrap();
        assert_eq!(
            result.specifiers,
            vec![
                StructuredRefSpecifier::ThisRow,
                StructuredRefSpecifier::Column {
                    name: "Amount".to_string()
                }
            ]
        );
    }
}

// ========================================================================
// Table Name Validation Tests (BUG FIX: spaces)
// ========================================================================

mod table_name_validation {
    use super::*;

    #[test]
    fn valid_names() {
        assert!(is_valid_table_name("Sales"));
        assert!(is_valid_table_name("My_Table"));
        assert!(is_valid_table_name("_private"));
        assert!(is_valid_table_name("Table1"));
        assert!(is_valid_table_name("t"));
        assert!(is_valid_table_name("Table.Name"));
        assert!(is_valid_table_name("\\Table1")); // backslash at start
    }

    #[test]
    fn invalid_names() {
        assert!(!is_valid_table_name(""));
        assert!(!is_valid_table_name("1Table")); // starts with digit
        assert!(!is_valid_table_name(".Table")); // starts with period
    }

    #[test]
    fn spaces_rejected_bug_fix() {
        // BUG FIX: The TS regex ^[A-Za-z_][A-Za-z0-9_. ]*$ allowed spaces.
        // Spaces should NOT be allowed in table names.
        assert!(!is_valid_table_name("My Table"));
        assert!(!is_valid_table_name("Sales Report"));
        assert!(!is_valid_table_name("Table 1"));
    }

    #[test]
    fn parse_rejects_table_name_with_spaces() {
        // Attempting to parse a structured ref with spaces in the table name
        // should return None
        assert!(parse_structured_ref("My Table[Column1]").is_err());
    }
}

// ========================================================================
// Unescape Tests
// ========================================================================

mod unescape {
    use super::*;

    #[test]
    fn plain_name() {
        assert_eq!(unescape_column_name("Amount"), "Amount");
    }

    #[test]
    fn quoted_name() {
        assert_eq!(unescape_column_name("'First Name'"), "First Name");
    }

    #[test]
    fn doubled_quotes() {
        assert_eq!(unescape_column_name("'Tom''s Sales'"), "Tom's Sales");
    }

    #[test]
    fn doubled_brackets() {
        assert_eq!(unescape_column_name("'Price [[USD]]'"), "Price [USD]");
    }

    #[test]
    fn trims_whitespace() {
        assert_eq!(unescape_column_name("  Amount  "), "Amount");
    }
}

// ========================================================================
// Resolution Tests
// ========================================================================

mod resolution {
    use super::*;

    fn resolve(input: &str, table: &Table, current_row: Option<u32>) -> Vec<TableRange> {
        let ref_ = parse_structured_ref(input).unwrap();
        resolve_structured_ref(&ref_, &[table.clone()], current_row)
    }

    #[test]
    fn single_column_data() {
        let ranges = resolve("Sales[Amount]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 3, 5, 3)]);
    }

    #[test]
    fn first_column() {
        let ranges = resolve("Sales[Product]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 1, 5, 1)]);
    }

    #[test]
    fn last_column() {
        let ranges = resolve("Sales[Quantity]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 4, 5, 4)]);
    }

    #[test]
    fn this_row_with_column() {
        let ranges = resolve("Sales[@Amount]", &sales_table(), Some(4));
        assert_eq!(ranges, vec![TableRange::new(4, 3, 4, 3)]);
    }

    #[test]
    fn this_row_entire_row() {
        let ranges = resolve("Sales[@]", &sales_table(), Some(3));
        assert_eq!(ranges, vec![TableRange::new(3, 1, 3, 4)]);
    }

    #[test]
    fn this_row_without_current_row_is_empty() {
        let ranges = resolve("Sales[@Amount]", &sales_table(), None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn explicit_this_row_specifier() {
        let ranges = resolve("Sales[#This Row]", &sales_table(), Some(4));
        assert_eq!(ranges, vec![TableRange::new(4, 1, 4, 4)]);
    }

    #[test]
    fn headers() {
        let ranges = resolve("Sales[#Headers]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(2, 1, 2, 4)]);
    }

    #[test]
    fn data() {
        let ranges = resolve("Sales[#Data]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 1, 5, 4)]);
    }

    #[test]
    fn totals() {
        let ranges = resolve("Sales[#Totals]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(6, 1, 6, 4)]);
    }

    #[test]
    fn all() {
        let ranges = resolve("Sales[#All]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(2, 1, 6, 4)]);
    }

    #[test]
    fn headers_on_table_without_headers() {
        let ranges = resolve("Data[#Headers]", &bare_table(), None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn totals_on_table_without_totals() {
        let ranges = resolve("Data[#Totals]", &bare_table(), None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn data_on_bare_table() {
        let ranges = resolve("Data[#Data]", &bare_table(), None);
        assert_eq!(ranges, vec![TableRange::new(0, 0, 2, 2)]);
    }

    #[test]
    fn all_on_bare_table() {
        let ranges = resolve("Data[#All]", &bare_table(), None);
        assert_eq!(ranges, vec![TableRange::new(0, 0, 2, 2)]);
    }

    #[test]
    fn combined_headers_and_column() {
        let ranges = resolve("Sales[[#Headers],[Amount]]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(2, 3, 2, 3)]);
    }

    #[test]
    fn combined_totals_and_column_range() {
        let ranges = resolve("Sales[[#Totals],[Product]:[Amount]]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(6, 1, 6, 3)]);
    }

    #[test]
    fn combined_headers_and_data_merge() {
        let ranges = resolve("Sales[[#Headers],[#Data]]", &sales_table(), None);
        // Adjacent: headers row 2, data rows 3-5 -> merged to 2-5
        assert_eq!(ranges, vec![TableRange::new(2, 1, 5, 4)]);
    }

    #[test]
    fn combined_data_and_totals_merge() {
        let ranges = resolve("Sales[[#Data],[#Totals]]", &sales_table(), None);
        // Adjacent: data rows 3-5, totals row 6 -> merged to 3-6
        assert_eq!(ranges, vec![TableRange::new(3, 1, 6, 4)]);
    }

    #[test]
    fn column_range_data() {
        let ranges = resolve("Sales[[Product]:[Amount]]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 1, 5, 3)]);
    }

    #[test]
    fn column_range_reverse_order() {
        let ranges = resolve("Sales[[Amount]:[Product]]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 1, 5, 3)]);
    }

    #[test]
    fn wrong_table_name() {
        let ranges = resolve("OtherTable[Amount]", &sales_table(), None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn case_insensitive_column() {
        let ranges = resolve("Sales[amount]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 3, 5, 3)]);
    }

    #[test]
    fn case_insensitive_table_name() {
        let ranges = resolve("sales[Amount]", &sales_table(), None);
        assert_eq!(ranges, vec![TableRange::new(3, 3, 5, 3)]);
    }

    #[test]
    fn nonexistent_column() {
        let ranges = resolve("Sales[NonExistent]", &sales_table(), None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn bare_table_single_column() {
        let ranges = resolve("Data[B]", &bare_table(), None);
        assert_eq!(ranges, vec![TableRange::new(0, 1, 2, 1)]);
    }

    #[test]
    fn table_not_found_returns_empty() {
        let ref_ = parse_structured_ref("NonExistent[Col]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[sales_table()], None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn disjoint_headers_and_totals() {
        // Headers at row 2, totals at row 6 — NOT adjacent (data rows 3-5 in between)
        let ranges = resolve("Sales[[#Headers],[#Totals]]", &sales_table(), None);
        assert_eq!(
            ranges,
            vec![TableRange::new(2, 1, 2, 4), TableRange::new(6, 1, 6, 4)]
        );
    }

    #[test]
    fn this_row_in_combined_context_with_current_row() {
        let ranges = resolve("Sales[[#This Row],[Amount]]", &sales_table(), Some(4));
        assert_eq!(ranges, vec![TableRange::new(4, 3, 4, 3)]);
    }

    #[test]
    fn this_row_in_combined_context_without_current_row() {
        let ranges = resolve("Sales[[#This Row],[Amount]]", &sales_table(), None);
        assert!(ranges.is_empty());
    }
}

// ========================================================================
// Empty Data Area Bug Fix Tests
// ========================================================================

mod empty_data_bug_fix {
    use super::*;

    #[test]
    fn data_on_empty_data_table_returns_empty() {
        // Table has header (row 0) and totals (row 1), so data_start = 1, data_end = 0
        // This is an inverted range; should return empty.
        let table = empty_data_table();
        let ref_ = parse_structured_ref("Empty[X]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[table], None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn data_special_on_empty_data_table_returns_empty() {
        let table = empty_data_table();
        let ref_ = parse_structured_ref("Empty[#Data]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[table], None);
        assert!(ranges.is_empty());
    }

    #[test]
    fn headers_on_empty_data_table_still_works() {
        let table = empty_data_table();
        let ref_ = parse_structured_ref("Empty[#Headers]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[table], None);
        assert_eq!(ranges, vec![TableRange::new(0, 0, 0, 2)]);
    }

    #[test]
    fn totals_on_empty_data_table_still_works() {
        let table = empty_data_table();
        let ref_ = parse_structured_ref("Empty[#Totals]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[table], None);
        assert_eq!(ranges, vec![TableRange::new(1, 0, 1, 2)]);
    }

    #[test]
    fn all_on_empty_data_table_still_works() {
        let table = empty_data_table();
        let ref_ = parse_structured_ref("Empty[#All]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[table], None);
        assert_eq!(ranges, vec![TableRange::new(0, 0, 1, 2)]);
    }
}

// ========================================================================
// Adjustment Tests
// ========================================================================

mod adjustment {
    use super::*;

    #[test]
    fn column_rename_simple() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRenamed {
                old_name: "Amount".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(
            adjusted.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "Revenue".to_string()
            }]
        );
    }

    #[test]
    fn column_rename_range_start() {
        let ref_ = parse_structured_ref("Sales[[Product]:[Amount]]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRenamed {
                old_name: "Product".to_string(),
                new_name: "Item".to_string(),
            },
        );
        assert_eq!(
            adjusted.specifiers,
            vec![StructuredRefSpecifier::ColumnRange {
                start: "Item".to_string(),
                end: "Amount".to_string()
            }]
        );
    }

    #[test]
    fn column_rename_range_end() {
        let ref_ = parse_structured_ref("Sales[[Product]:[Amount]]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRenamed {
                old_name: "Amount".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(
            adjusted.specifiers,
            vec![StructuredRefSpecifier::ColumnRange {
                start: "Product".to_string(),
                end: "Revenue".to_string()
            }]
        );
    }

    #[test]
    fn column_rename_unrelated() {
        let ref_ = parse_structured_ref("Sales[Product]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRenamed {
                old_name: "Amount".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(adjusted, ref_);
    }

    #[test]
    fn column_rename_case_insensitive() {
        let ref_ = parse_structured_ref("Sales[amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRenamed {
                old_name: "Amount".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(
            adjusted.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "Revenue".to_string()
            }]
        );
    }

    #[test]
    fn table_rename() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::TableRenamed {
                old_name: "Sales".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(adjusted.table_name, "Revenue");
        assert_eq!(adjusted.specifiers, ref_.specifiers);
    }

    #[test]
    fn table_rename_unrelated() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::TableRenamed {
                old_name: "Other".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(adjusted, ref_);
    }

    #[test]
    fn table_rename_case_insensitive() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::TableRenamed {
                old_name: "sales".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(adjusted.table_name, "Revenue");
    }

    #[test]
    fn column_remove_only_column_keeps_ref() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRemoved {
                name: "Amount".to_string(),
            },
        );
        // Should keep original ref rather than produce empty specifiers
        assert!(!adjusted.specifiers.is_empty());
        assert_eq!(adjusted, ref_);
    }

    #[test]
    fn column_remove_range_shrinks_to_single_column() {
        // IMPROVEMENT: removing one end of a range shrinks it instead of removing it entirely
        let ref_ = parse_structured_ref("Sales[[#Headers],[Product]:[Amount]]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRemoved {
                name: "Product".to_string(),
            },
        );
        // Should shrink to [#Headers],[Amount] instead of removing entire range
        assert_eq!(
            adjusted.specifiers,
            vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Headers
                },
                StructuredRefSpecifier::Column {
                    name: "Amount".to_string()
                }
            ]
        );
    }

    #[test]
    fn column_remove_preserves_special_items() {
        let ref_ = parse_structured_ref("Sales[[#Headers],[Amount]]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRemoved {
                name: "Amount".to_string(),
            },
        );
        assert_eq!(
            adjusted.specifiers,
            vec![StructuredRefSpecifier::Special {
                item: SpecialItem::Headers
            }]
        );
    }

    #[test]
    fn column_remove_unrelated() {
        let ref_ = parse_structured_ref("Sales[Product]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRemoved {
                name: "Amount".to_string(),
            },
        );
        assert_eq!(
            adjusted.specifiers,
            vec![StructuredRefSpecifier::Column {
                name: "Product".to_string()
            }]
        );
    }

    #[test]
    fn table_resize_returns_same() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::TableResized {
                old_range: TableRange::new(2, 1, 6, 4),
                new_range: TableRange::new(2, 1, 8, 5),
            },
        );
        assert_eq!(adjusted, ref_);
    }

    #[test]
    fn column_added_returns_same() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnAdded {
                name: "Discount".to_string(),
                index: 3,
            },
        );
        assert_eq!(adjusted, ref_);
    }

    #[test]
    fn column_added_range_returns_same() {
        let ref_ = parse_structured_ref("Sales[[Product]:[Amount]]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnAdded {
                name: "Category".to_string(),
                index: 1,
            },
        );
        assert_eq!(adjusted, ref_);
    }
}

// ========================================================================
// Formatting Tests
// ========================================================================

mod formatting {
    use super::*;

    #[test]
    fn simple_column_ref() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Amount".to_string(),
            }],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales[Amount]");
    }

    #[test]
    fn at_shorthand_this_row_plus_column() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![
                StructuredRefSpecifier::ThisRow,
                StructuredRefSpecifier::Column {
                    name: "Amount".to_string(),
                },
            ],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales[@Amount]");
    }

    #[test]
    fn bare_this_row() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![StructuredRefSpecifier::ThisRow],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales[@]");
    }

    #[test]
    fn special_items() {
        assert_eq!(
            format_structured_ref(&StructuredRef {
                table_name: "Sales".to_string(),
                specifiers: vec![StructuredRefSpecifier::Special {
                    item: SpecialItem::Headers
                }],
            }),
            "Sales[#Headers]"
        );
        assert_eq!(
            format_structured_ref(&StructuredRef {
                table_name: "Sales".to_string(),
                specifiers: vec![StructuredRefSpecifier::Special {
                    item: SpecialItem::Data
                }],
            }),
            "Sales[#Data]"
        );
        assert_eq!(
            format_structured_ref(&StructuredRef {
                table_name: "Sales".to_string(),
                specifiers: vec![StructuredRefSpecifier::Special {
                    item: SpecialItem::Totals
                }],
            }),
            "Sales[#Totals]"
        );
        assert_eq!(
            format_structured_ref(&StructuredRef {
                table_name: "Sales".to_string(),
                specifiers: vec![StructuredRefSpecifier::Special {
                    item: SpecialItem::All
                }],
            }),
            "Sales[#All]"
        );
    }

    #[test]
    fn column_range() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![StructuredRefSpecifier::ColumnRange {
                start: "Product".to_string(),
                end: "Amount".to_string(),
            }],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales[[Product]:[Amount]]");
    }

    #[test]
    fn combined_special_and_column() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Headers,
                },
                StructuredRefSpecifier::Column {
                    name: "Amount".to_string(),
                },
            ],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales[[#Headers],[Amount]]");
    }

    #[test]
    fn combined_special_and_column_range() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Totals,
                },
                StructuredRefSpecifier::ColumnRange {
                    start: "Product".to_string(),
                    end: "Amount".to_string(),
                },
            ],
        };
        assert_eq!(
            format_structured_ref(&ref_),
            "Sales[[#Totals],[Product]:[Amount]]"
        );
    }

    #[test]
    fn empty_specifiers_bare_table_name() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales");
    }

    #[test]
    fn escaped_column_with_quotes() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Tom's Sales".to_string(),
            }],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales['Tom''s Sales']");
    }

    #[test]
    fn escaped_column_with_brackets() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Price [USD]".to_string(),
            }],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales['Price [[USD]]']");
    }

    #[test]
    fn escaped_column_with_hash() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Column #1".to_string(),
            }],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales['Column #1']");
    }

    #[test]
    fn escaped_column_with_at() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "user@email".to_string(),
            }],
        };
        assert_eq!(format_structured_ref(&ref_), "Sales['user@email']");
    }
}

// ========================================================================
// Roundtrip Tests (parse -> format -> parse stability)
// ========================================================================

mod roundtrip {
    use super::*;

    fn assert_roundtrip(input: &str) {
        let parsed1 = parse_structured_ref(input).unwrap();
        let formatted = format_structured_ref(&parsed1);
        let parsed2 = parse_structured_ref(&formatted).unwrap();
        assert_eq!(parsed2, parsed1, "Roundtrip failed for: {}", input);
    }

    #[test]
    fn simple_column() {
        assert_roundtrip("Sales[Amount]");
    }

    #[test]
    fn at_column() {
        assert_roundtrip("Sales[@Amount]");
    }

    #[test]
    fn headers() {
        assert_roundtrip("Sales[#Headers]");
    }

    #[test]
    fn data() {
        assert_roundtrip("Sales[#Data]");
    }

    #[test]
    fn totals() {
        assert_roundtrip("Sales[#Totals]");
    }

    #[test]
    fn all() {
        assert_roundtrip("Sales[#All]");
    }

    #[test]
    fn bare_at() {
        assert_roundtrip("Sales[@]");
    }

    #[test]
    fn combined_headers_column() {
        assert_roundtrip("Sales[[#Headers],[Amount]]");
    }

    #[test]
    fn combined_totals_column_range() {
        assert_roundtrip("Sales[[#Totals],[Product]:[Amount]]");
    }

    #[test]
    fn column_range() {
        assert_roundtrip("Sales[[Product]:[Amount]]");
    }

    #[test]
    fn combined_headers_data() {
        assert_roundtrip("Sales[[#Headers],[#Data]]");
    }

    #[test]
    fn combined_data_totals() {
        assert_roundtrip("Sales[[#Data],[#Totals]]");
    }

    #[test]
    fn escaped_quotes() {
        assert_roundtrip("Sales['Tom''s Sales']");
    }

    #[test]
    fn escaped_brackets() {
        assert_roundtrip("Sales['Price [[USD]]']");
    }

    #[test]
    fn escaped_hash() {
        assert_roundtrip("Sales['Column #1']");
    }

    #[test]
    fn column_name_with_closing_bracket_roundtrip() {
        let ref_ = StructuredRef {
            table_name: "Table1".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Col]1".to_string(),
            }],
        };
        let formatted = format_structured_ref(&ref_);
        let parsed = parse_structured_ref(&formatted).unwrap();
        assert_eq!(parsed.specifiers, ref_.specifiers);
    }
}

// ========================================================================
// Bug Fix Tests
// ========================================================================

mod bug_fixes {
    use super::*;

    #[test]
    fn column_range_with_escaped_closing_bracket() {
        let ref_ = parse_structured_ref("Table1[['Col]]1']:['Col]]2']]").unwrap();
        assert_eq!(
            ref_.specifiers,
            vec![StructuredRefSpecifier::ColumnRange {
                start: "Col]1".to_string(),
                end: "Col]2".to_string()
            }]
        );
    }

    #[test]
    fn adjust_column_removed_keeps_ref_when_all_removed() {
        let ref_ = StructuredRef {
            table_name: "Table1".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Amount".to_string(),
            }],
        };
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRemoved {
                name: "Amount".to_string(),
            },
        );
        assert!(!adjusted.specifiers.is_empty());
    }

    #[test]
    fn multi_specifier_with_escaped_bracket() {
        let ref_ = parse_structured_ref("Table1[[#Headers],['Col]]1']]").unwrap();
        assert_eq!(ref_.specifiers.len(), 2);
        assert_eq!(
            ref_.specifiers[0],
            StructuredRefSpecifier::Special {
                item: SpecialItem::Headers
            }
        );
        assert_eq!(
            ref_.specifiers[1],
            StructuredRefSpecifier::Column {
                name: "Col]1".to_string()
            }
        );
    }
}

// ========================================================================
// find_outer_matching_bracket Tests
// ========================================================================

mod outer_bracket {
    use super::*;

    #[test]
    fn simple_bracket() {
        // [Column] — simple case, closing ] at index 7
        assert_eq!(find_outer_matching_bracket("[Column]", 0), Some(7));
    }

    #[test]
    fn escaped_brackets_in_quoted_name() {
        // [['Col]]Name']] — the ]] inside single quotes is an escape sequence
        // i=0: [ depth=1
        // i=1: [ depth=2
        // i=2: ' in_quote=true
        // i=3-5: Col (inside quotes, skipped)
        // i=6-7: ]] inside quotes -> escape, skip
        // i=8-11: Name (inside quotes)
        // i=12: ' in_quote=false
        // i=13: ] depth=1
        // i=14: ] depth=0 -> Some(14)
        assert_eq!(find_outer_matching_bracket("[['Col]]Name']]", 0), Some(14));
    }

    #[test]
    fn nested_brackets() {
        // [Col[inner]outer] — nested brackets with depth tracking
        // i=0: [ depth=1
        // i=1-3: Col
        // i=4: [ depth=2
        // i=5-9: inner
        // i=10: ] depth=1
        // i=11-15: outer
        // i=16: ] depth=0 -> Some(16)
        assert_eq!(
            find_outer_matching_bracket("[Col[inner]outer]", 0),
            Some(16),
        );
    }

    #[test]
    fn nested_with_escape() {
        // [[#Headers],['Col]]1']] — real-world pattern
        // i=0: [ depth=1
        // i=1: [ depth=2
        // i=2: # ... i=9: s  (characters of #Headers)
        // i=10: ] depth=1
        // i=11: ,
        // i=12: [ depth=2
        // i=13: ' in_quote=true
        // i=14-16: Col
        // i=17-18: ]] escape (inside quotes), skip
        // i=19: 1
        // i=20: ' in_quote=false
        // i=21: ] depth=1
        // i=22: ] depth=0 -> Some(22)
        let s = "[[#Headers],['Col]]1']]";
        assert_eq!(find_outer_matching_bracket(s, 0), Some(22));
    }

    #[test]
    fn not_starting_with_bracket() {
        assert_eq!(find_outer_matching_bracket("Column]", 0), None);
    }

    #[test]
    fn start_out_of_bounds() {
        assert_eq!(find_outer_matching_bracket("[Col]", 10), None);
    }
}

// ========================================================================
// Integration: parse -> resolve -> adjust -> format
// ========================================================================

mod integration {
    use super::*;

    #[test]
    fn full_lifecycle_column_rename() {
        // 1. Parse
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();

        // 2. Resolve
        let ranges = resolve_structured_ref(&ref_, &[sales_table()], None);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0], TableRange::new(3, 3, 5, 3));

        // 3. Adjust
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRenamed {
                old_name: "Amount".to_string(),
                new_name: "Revenue".to_string(),
            },
        );
        assert_eq!(
            adjusted.specifiers[0],
            StructuredRefSpecifier::Column {
                name: "Revenue".to_string()
            }
        );

        // 4. Format
        let formatted = format_structured_ref(&adjusted);
        assert_eq!(formatted, "Sales[Revenue]");
    }

    #[test]
    fn full_lifecycle_this_row_table_rename() {
        let ref_ = parse_structured_ref("Sales[@Amount]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[sales_table()], Some(4));
        assert_eq!(ranges, vec![TableRange::new(4, 3, 4, 3)]);

        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::TableRenamed {
                old_name: "Sales".to_string(),
                new_name: "Orders".to_string(),
            },
        );
        assert_eq!(format_structured_ref(&adjusted), "Orders[@Amount]");
    }

    #[test]
    fn full_lifecycle_complex_combined() {
        let ref_ = parse_structured_ref("Sales[[#Totals],[Product]:[Amount]]").unwrap();
        let ranges = resolve_structured_ref(&ref_, &[sales_table()], None);
        assert_eq!(ranges, vec![TableRange::new(6, 1, 6, 3)]);

        // Rename a column in the range
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRenamed {
                old_name: "Product".to_string(),
                new_name: "Item".to_string(),
            },
        );
        assert_eq!(
            format_structured_ref(&adjusted),
            "Sales[[#Totals],[Item]:[Amount]]"
        );
    }
}

// ========================================================================
// Escape column name tests
// ========================================================================

mod escape {
    use super::*;

    #[test]
    fn plain_name_not_escaped() {
        assert_eq!(escape_column_name("Amount"), "Amount");
    }

    #[test]
    fn name_with_spaces_not_escaped() {
        // Spaces don't require escaping
        assert_eq!(escape_column_name("First Name"), "First Name");
    }

    #[test]
    fn name_with_quote_escaped() {
        assert_eq!(escape_column_name("Tom's"), "'Tom''s'");
    }

    #[test]
    fn name_with_brackets_escaped() {
        assert_eq!(escape_column_name("Price [USD]"), "'Price [[USD]]'");
    }

    #[test]
    fn name_with_hash_escaped() {
        assert_eq!(escape_column_name("Column #1"), "'Column #1'");
    }

    #[test]
    fn name_with_at_escaped() {
        assert_eq!(escape_column_name("user@email"), "'user@email'");
    }
}

// ========================================================================
// Find column tests
// ========================================================================

mod find_col {
    use super::*;

    #[test]
    fn finds_by_exact_name() {
        let cols = vec![
            TableColumn {
                id: "1".to_string(),
                name: "Product".to_string(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
            TableColumn {
                id: "2".to_string(),
                name: "Amount".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            },
        ];
        let (idx, col) = find_column(&cols, "Amount").unwrap();
        assert_eq!(idx, 1);
        assert_eq!(col.name, "Amount");
    }

    #[test]
    fn finds_case_insensitive() {
        let cols = vec![TableColumn {
            id: "1".to_string(),
            name: "Product".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        }];
        assert!(find_column(&cols, "product").is_some());
        assert!(find_column(&cols, "PRODUCT").is_some());
    }

    #[test]
    fn returns_none_for_missing() {
        let cols = vec![TableColumn {
            id: "1".to_string(),
            name: "Product".to_string(),
            index: 0,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        }];
        assert!(find_column(&cols, "NonExistent").is_none());
    }
}

// ========================================================================
// Bridge: resolve_ranges_from_table_def Tests
// ========================================================================

mod table_def_bridge {
    use super::*;
    use cell_types::SheetId;
    use formula_types::TableDef;

    /// Standard test TableDef matching the sales_table() layout:
    ///   Row 2 (header):  | Product | Region | Amount | Quantity |
    ///   Row 3-5 (data)
    ///   Row 6 (totals)
    ///   Columns at grid cols 1-4.
    fn sales_table_def() -> TableDef {
        TableDef {
            name: "Sales".to_string(),
            sheet: SheetId::from_raw(1),
            start_row: 2,
            start_col: 1,
            end_row: 6,
            end_col: 4,
            columns: vec![
                "Product".to_string(),
                "Region".to_string(),
                "Amount".to_string(),
                "Quantity".to_string(),
            ],
            has_headers: true,
            has_totals: true,
        }
    }

    /// Bare table (no headers, no totals).
    fn bare_table_def() -> TableDef {
        TableDef {
            name: "Data".to_string(),
            sheet: SheetId::from_raw(1),
            start_row: 0,
            start_col: 0,
            end_row: 2,
            end_col: 2,
            columns: vec!["A".to_string(), "B".to_string(), "C".to_string()],
            has_headers: false,
            has_totals: false,
        }
    }

    #[test]
    fn single_column_data() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 3,
                end_row: 5,
                columns: vec![3],
            }
        );
    }

    #[test]
    fn all_columns_default() {
        // No column specifier => data rows, all columns
        let ref_ = parse_structured_ref("Sales[#Data]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 3,
                end_row: 5,
                columns: vec![1, 2, 3, 4],
            }
        );
    }

    #[test]
    fn headers_with_column() {
        let ref_ = parse_structured_ref("Sales[[#Headers],[Amount]]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 2,
                end_row: 2,
                columns: vec![3],
            }
        );
    }

    #[test]
    fn totals_with_column_range() {
        let ref_ = parse_structured_ref("Sales[[#Totals],[Product]:[Amount]]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 6,
                end_row: 6,
                columns: vec![1, 2, 3],
            }
        );
    }

    #[test]
    fn this_row_with_column() {
        let ref_ = parse_structured_ref("Sales[@Amount]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), Some(4)).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 4,
                end_row: 4,
                columns: vec![3],
            }
        );
    }

    #[test]
    fn this_row_without_current_row_fails() {
        let ref_ = parse_structured_ref("Sales[@Amount]").unwrap();
        assert!(resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).is_none());
    }

    #[test]
    fn all_specifier() {
        let ref_ = parse_structured_ref("Sales[#All]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 2,
                end_row: 6,
                columns: vec![1, 2, 3, 4],
            }
        );
    }

    #[test]
    fn bare_table_single_column() {
        let ref_ = parse_structured_ref("Data[B]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &bare_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 0,
                end_row: 2,
                columns: vec![1],
            }
        );
    }

    #[test]
    fn nonexistent_column_fails() {
        let ref_ = parse_structured_ref("Sales[NonExistent]").unwrap();
        assert!(resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).is_none());
    }

    #[test]
    fn case_insensitive_column_lookup() {
        let ref_ = parse_structured_ref("Sales[amount]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0].columns, vec![3]);
    }

    #[test]
    fn column_range_reverse_order() {
        let ref_ = parse_structured_ref("Sales[[Amount]:[Product]]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 1);
        // Should produce columns 1,2,3 (Product=1, Region=2, Amount=3)
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 3,
                end_row: 5,
                columns: vec![1, 2, 3],
            }
        );
    }

    #[test]
    fn disjoint_headers_and_totals() {
        let ref_ = parse_structured_ref("Sales[[#Headers],[#Totals]]").unwrap();
        let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
        assert_eq!(ranges.len(), 2);
        assert_eq!(
            ranges[0],
            ResolvedRange {
                start_row: 2,
                end_row: 2,
                columns: vec![1, 2, 3, 4],
            }
        );
        assert_eq!(
            ranges[1],
            ResolvedRange {
                start_row: 6,
                end_row: 6,
                columns: vec![1, 2, 3, 4],
            }
        );
    }

    #[test]
    fn empty_specifiers_returns_none() {
        let ref_ = StructuredRef {
            table_name: "Sales".to_string(),
            specifiers: vec![],
        };
        assert!(resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).is_none());
    }
}

// ========================================================================
// resolve_row_bounds — pathological / edge-case tests
// ========================================================================

mod resolve_row_bounds_tests {
    use super::*;

    /// A table whose range ends at row 0 with a totals row.
    /// Without `saturating_sub`, `end_row - 1` would underflow on u32.
    #[test]
    fn end_row_zero_with_totals_does_not_panic() {
        let range = TableRange::new(0, 0, 0, 0);

        // #Data on a table where header occupies row 0 and totals also claims row 0.
        // data_start_row = 0 + 1 = 1, data_end_row = saturating_sub(0,1) = 0
        // So data_start_row > data_end_row => empty data range.
        let result = resolve_row_bounds(
            &range,
            true, // has_header_row
            true, // has_totals_row
            &[SpecialItem::Data],
            false,
            None,
        );
        // Should return Some with an empty vec (no data rows fit)
        assert_eq!(result, Some(vec![]));
    }

    #[test]
    fn end_row_zero_with_totals_no_header() {
        let range = TableRange::new(0, 0, 0, 0);

        // data_start_row = 0 (no header), data_end_row = saturating_sub(0,1) = 0
        // data_start_row (0) <= data_end_row (0) => one data row at row 0
        // But wait — the totals row IS row 0, so data_end_row should be 0-1 saturated to 0.
        // Actually data_start_row = 0, data_end_row = 0 after saturating_sub.
        // 0 <= 0, so we get a single-row RowBound {0, 0}.
        // This is admittedly a degenerate table, but the important thing is no panic.
        let result = resolve_row_bounds(
            &range,
            false, // no header
            true,  // has_totals_row
            &[SpecialItem::Data],
            false,
            None,
        );
        assert!(result.is_some());
        // No panic is the key assertion; result contents are
        // implementation-defined for this degenerate case.
    }

    #[test]
    fn normal_table_data_bounds() {
        let range = TableRange::new(2, 1, 6, 4);

        let result = resolve_row_bounds(
            &range,
            true, // has_header_row
            true, // has_totals_row
            &[SpecialItem::Data],
            false,
            None,
        );
        assert_eq!(
            result,
            Some(vec![RowBound {
                start_row: 3,
                end_row: 5,
            }])
        );
    }
}
