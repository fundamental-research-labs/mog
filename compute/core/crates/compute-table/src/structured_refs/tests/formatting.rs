use super::*;

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

mod escape {
    use super::*;

    #[test]
    fn plain_name_not_escaped() {
        assert_eq!(escape_column_name("Amount"), "Amount");
    }

    #[test]
    fn name_with_spaces_not_escaped() {
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
