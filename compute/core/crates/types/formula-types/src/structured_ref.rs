//! Structured reference types for Excel-style table references.
//!
//! These types represent parsed structured references like `Table1[Column1]`,
//! `Table1[@Column1]`, `Table1[[#Headers],[Col1]:[Col3]]`, etc.
//!
//! Pure data types with serde support — no runtime dependencies.

use serde::{Deserialize, Serialize};

/// A structured reference to a table region (e.g., `Table1[Column1]`).
#[doc(alias = "table reference")]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredRef {
    /// Name of the referenced table.
    pub table_name: String,
    /// Specifiers within the reference.
    pub specifiers: Vec<StructuredRefSpecifier>,
}

/// Specifier within a structured reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StructuredRefSpecifier {
    /// Reference to a single column by name.
    #[serde(rename = "column")]
    Column {
        /// Column name.
        name: String,
    },
    /// Reference to a range of columns.
    #[serde(rename = "columnRange")]
    ColumnRange {
        /// Start column name.
        start: String,
        /// End column name.
        end: String,
    },
    /// Reference to the current row.
    #[serde(rename = "thisRow")]
    ThisRow,
    /// Reference to a special table region.
    #[serde(rename = "special")]
    Special {
        /// The special item type.
        item: SpecialItem,
    },
}

/// Special items in structured references.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpecialItem {
    /// All rows including headers and totals.
    All,
    /// Data rows only (excludes headers and totals).
    Data,
    /// Header row only.
    Headers,
    /// Totals row only.
    Totals,
    /// Current row (same as @).
    ThisRow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_ref_column_serde_roundtrip() {
        let sr = StructuredRef {
            table_name: "Sales".into(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Revenue".into(),
            }],
        };
        let json = serde_json::to_string(&sr).unwrap();
        let sr2: StructuredRef = serde_json::from_str(&json).unwrap();
        assert_eq!(sr, sr2);
        assert_eq!(sr2.table_name, "Sales");
    }

    #[test]
    fn structured_ref_column_range_serde_roundtrip() {
        let sr = StructuredRef {
            table_name: "Data".into(),
            specifiers: vec![StructuredRefSpecifier::ColumnRange {
                start: "A".into(),
                end: "C".into(),
            }],
        };
        let json = serde_json::to_string(&sr).unwrap();
        let sr2: StructuredRef = serde_json::from_str(&json).unwrap();
        assert_eq!(sr, sr2);
    }

    #[test]
    fn structured_ref_this_row_serde() {
        let sr = StructuredRef {
            table_name: "T1".into(),
            specifiers: vec![StructuredRefSpecifier::ThisRow],
        };
        let json = serde_json::to_string(&sr).unwrap();
        let sr2: StructuredRef = serde_json::from_str(&json).unwrap();
        assert_eq!(sr, sr2);
    }

    #[test]
    fn special_item_all_variants_serialize() {
        let items = [
            SpecialItem::All,
            SpecialItem::Data,
            SpecialItem::Headers,
            SpecialItem::Totals,
            SpecialItem::ThisRow,
        ];
        for item in &items {
            let json = serde_json::to_string(item).unwrap();
            let item2: SpecialItem = serde_json::from_str(&json).unwrap();
            assert_eq!(item, &item2);
        }
    }

    #[test]
    fn special_item_json_format() {
        assert_eq!(serde_json::to_string(&SpecialItem::All).unwrap(), "\"all\"");
        assert_eq!(
            serde_json::to_string(&SpecialItem::Data).unwrap(),
            "\"data\""
        );
        assert_eq!(
            serde_json::to_string(&SpecialItem::Headers).unwrap(),
            "\"headers\""
        );
        assert_eq!(
            serde_json::to_string(&SpecialItem::Totals).unwrap(),
            "\"totals\""
        );
        assert_eq!(
            serde_json::to_string(&SpecialItem::ThisRow).unwrap(),
            "\"thisRow\""
        );
    }

    #[test]
    fn structured_ref_special_serde() {
        let sr = StructuredRef {
            table_name: "T".into(),
            specifiers: vec![StructuredRefSpecifier::Special {
                item: SpecialItem::Headers,
            }],
        };
        let json = serde_json::to_string(&sr).unwrap();
        let sr2: StructuredRef = serde_json::from_str(&json).unwrap();
        assert_eq!(sr, sr2);
    }

    #[test]
    fn structured_ref_multiple_specifiers() {
        let sr = StructuredRef {
            table_name: "T".into(),
            specifiers: vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Data,
                },
                StructuredRefSpecifier::Column {
                    name: "Price".into(),
                },
            ],
        };
        let json = serde_json::to_string(&sr).unwrap();
        let sr2: StructuredRef = serde_json::from_str(&json).unwrap();
        assert_eq!(sr2.specifiers.len(), 2);
    }
}
