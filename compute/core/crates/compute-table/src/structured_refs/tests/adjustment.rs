use super::*;

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
        assert!(!adjusted.specifiers.is_empty());
        assert_eq!(adjusted, ref_);
    }

    #[test]
    fn column_remove_range_shrinks_to_single_column() {
        let ref_ = parse_structured_ref("Sales[[#Headers],[Product]:[Amount]]").unwrap();
        let adjusted = adjust_structured_ref(
            &ref_,
            &TableStructureChange::ColumnRemoved {
                name: "Product".to_string(),
            },
        );
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

mod bug_fixes {
    use super::*;

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
}
