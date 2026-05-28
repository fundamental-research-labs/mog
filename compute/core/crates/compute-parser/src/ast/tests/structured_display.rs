use crate::ast::ASTNode;
use formula_types::{SpecialItem, StructuredRef, StructuredRefSpecifier};

#[test]
fn test_display_structured_ref_simple() {
    let sr = StructuredRef {
        table_name: "Table1".to_string(),
        specifiers: vec![StructuredRefSpecifier::Column {
            name: "Col1".to_string(),
        }],
    };
    assert_eq!(format!("{}", ASTNode::StructuredRef(sr)), "Table1[[Col1]]");
}

#[test]
fn test_display_structured_ref_with_specifiers() {
    let sr = StructuredRef {
        table_name: "Table1".to_string(),
        specifiers: vec![
            StructuredRefSpecifier::Special {
                item: SpecialItem::Headers,
            },
            StructuredRefSpecifier::Column {
                name: "Col1".to_string(),
            },
        ],
    };
    assert_eq!(
        format!("{}", ASTNode::StructuredRef(sr)),
        "Table1[[#Headers],[Col1]]"
    );
}

#[test]
fn test_display_structured_ref_column_range() {
    let sr = StructuredRef {
        table_name: "Table1".to_string(),
        specifiers: vec![StructuredRefSpecifier::ColumnRange {
            start: "Col1".to_string(),
            end: "Col2".to_string(),
        }],
    };
    assert_eq!(
        format!("{}", ASTNode::StructuredRef(sr)),
        "Table1[[Col1]:[Col2]]"
    );
}

#[test]
fn structured_ref_special_items_display() {
    let cases = [
        (SpecialItem::All, "Table1[[#All]]"),
        (SpecialItem::Data, "Table1[[#Data]]"),
        (SpecialItem::Headers, "Table1[[#Headers]]"),
        (SpecialItem::Totals, "Table1[[#Totals]]"),
        (SpecialItem::ThisRow, "Table1[[#This Row]]"),
    ];

    for (item, expected) in cases {
        let sr = StructuredRef {
            table_name: "Table1".to_string(),
            specifiers: vec![StructuredRefSpecifier::Special { item }],
        };

        assert_eq!(format!("{}", ASTNode::StructuredRef(sr)), expected);
    }
}

#[test]
fn structured_ref_this_row_display() {
    let sr = StructuredRef {
        table_name: "Table1".to_string(),
        specifiers: vec![StructuredRefSpecifier::ThisRow],
    };

    assert_eq!(
        format!("{}", ASTNode::StructuredRef(sr)),
        "Table1[[#This Row]]"
    );
}
