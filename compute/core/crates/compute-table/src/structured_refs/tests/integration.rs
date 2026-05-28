use super::*;

mod integration {
    use super::*;

    #[test]
    fn full_lifecycle_column_rename() {
        let ref_ = parse_structured_ref("Sales[Amount]").unwrap();

        let ranges = resolve_structured_ref(&ref_, &[sales_table()], None);
        assert_eq!(ranges.len(), 1);
        assert_eq!(ranges[0], TableRange::new(3, 3, 5, 3));

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
