use super::*;

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
        assert_eq!(ranges, vec![TableRange::new(2, 1, 5, 4)]);
    }

    #[test]
    fn combined_data_and_totals_merge() {
        let ranges = resolve("Sales[[#Data],[#Totals]]", &sales_table(), None);
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

mod empty_data_bug_fix {
    use super::*;

    #[test]
    fn data_on_empty_data_table_returns_empty() {
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
                ..Default::default()
            },
            TableColumn {
                id: "2".to_string(),
                name: "Amount".to_string(),
                index: 1,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
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
            ..Default::default()
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
            ..Default::default()
        }];
        assert!(find_column(&cols, "NonExistent").is_none());
    }
}

mod resolve_row_bounds_tests {
    use super::*;

    #[test]
    fn end_row_zero_with_totals_does_not_panic() {
        let range = TableRange::new(0, 0, 0, 0);

        let result = resolve_row_bounds(&range, true, true, &[SpecialItem::Data], false, None);
        assert_eq!(result, Some(vec![]));
    }

    #[test]
    fn end_row_zero_with_totals_no_header() {
        let range = TableRange::new(0, 0, 0, 0);

        let result = resolve_row_bounds(&range, false, true, &[SpecialItem::Data], false, None);
        assert!(result.is_some());
    }

    #[test]
    fn normal_table_data_bounds() {
        let range = TableRange::new(2, 1, 6, 4);

        let result = resolve_row_bounds(&range, true, true, &[SpecialItem::Data], false, None);
        assert_eq!(
            result,
            Some(vec![RowBound {
                start_row: 3,
                end_row: 5,
            }])
        );
    }
}
