use super::*;

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
        assert!(is_valid_table_name("\\Table1"));
    }

    #[test]
    fn invalid_names() {
        assert!(!is_valid_table_name(""));
        assert!(!is_valid_table_name("1Table"));
        assert!(!is_valid_table_name(".Table"));
    }

    #[test]
    fn spaces_rejected_bug_fix() {
        assert!(!is_valid_table_name("My Table"));
        assert!(!is_valid_table_name("Sales Report"));
        assert!(!is_valid_table_name("Table 1"));
    }

    #[test]
    fn parse_rejects_table_name_with_spaces() {
        assert!(parse_structured_ref("My Table[Column1]").is_err());
    }
}

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

mod outer_bracket {
    use super::*;

    #[test]
    fn simple_bracket() {
        assert_eq!(find_outer_matching_bracket("[Column]", 0), Some(7));
    }

    #[test]
    fn escaped_brackets_in_quoted_name() {
        assert_eq!(find_outer_matching_bracket("[['Col]]Name']]", 0), Some(14));
    }

    #[test]
    fn nested_brackets() {
        assert_eq!(
            find_outer_matching_bracket("[Col[inner]outer]", 0),
            Some(16),
        );
    }

    #[test]
    fn nested_with_escape() {
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
