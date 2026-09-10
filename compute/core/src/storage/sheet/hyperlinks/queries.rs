use crate::cells::SheetStore;
use cell_types::SheetId;
use compute_parser::{ASTNode, FormulaSource};
use domain_types::domain::hyperlink::Hyperlink;

use crate::range_manager::pos_to_a1;
use crate::storage::WorkbookStorage;

/// Read explicit hyperlink metadata at its anchor position.
pub fn get_hyperlink(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: &SheetStore,
    row: u32,
    col: u32,
) -> Option<String> {
    let id = grid.cell_id_at(cell_types::SheetPos::new(row, col))?;
    let link = &storage
        .sheet_metadata
        .get(sheet_id)?
        .hyperlinks
        .iter()
        .find(|link| link.start_id == id)?
        .data;
    link.target
        .clone()
        .or_else(|| link.location.clone())
        .or_else(|| link.uid.as_ref().map(|_| String::new()))
}

/// Project stable anchors to current coordinates, preserving authored order.
pub fn get_all_hyperlinks(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: &SheetStore,
) -> Vec<Hyperlink> {
    let Some(metadata) = storage.sheet_metadata.get(sheet_id) else {
        return Vec::new();
    };
    metadata
        .hyperlinks
        .iter()
        .filter_map(|stored| {
            let (row, col) = grid.cell_position(&stored.start_id)?;
            let mut data = stored.data.clone();
            data.cell_ref = pos_to_a1(row, col);
            if let Some(end_id) = stored.end_id {
                let (row, col) = grid.cell_position(&end_id)?;
                data.cell_ref.push(':');
                data.cell_ref.push_str(&pos_to_a1(row, col));
            }
            Some(data)
        })
        .collect()
}

pub(crate) fn hyperlink_formula_url(formula: &str) -> Option<String> {
    let formula = formula.trim();
    if formula.is_empty() {
        return None;
    }

    let parsed = FormulaSource::parse(formula);
    let ASTNode::Function { name, args } = parsed.ast else {
        return None;
    };

    if !name.eq_ignore_ascii_case("HYPERLINK") {
        return None;
    }

    match args.first() {
        Some(ASTNode::Text(url)) => Some(url.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod formula_tests {
    use super::hyperlink_formula_url;

    #[test]
    fn extracts_literal_hyperlink_function_url() {
        assert_eq!(
            hyperlink_formula_url(r#"HYPERLINK("https://example.com","Example")"#),
            Some("https://example.com".to_string())
        );
        assert_eq!(
            hyperlink_formula_url(r#"=hyperlink("https://example.com")"#),
            Some("https://example.com".to_string())
        );
    }

    #[test]
    fn ignores_non_literal_or_non_hyperlink_formulas() {
        assert_eq!(hyperlink_formula_url(r#""Example""#), None);
        assert_eq!(hyperlink_formula_url(r#"HYPERLINK(A1,"Example")"#), None);
    }
}
