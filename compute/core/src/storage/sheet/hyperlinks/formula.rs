use std::sync::Arc;

use compute_document::schema::KEY_FORMULA;
use compute_parser::ASTNode;
use yrs::{Any, Map, MapRef, Out, TransactionMut};

use super::keys::KEY_HYPERLINK;

pub(super) fn read_formula_hyperlink_url<T: yrs::ReadTxn>(
    txn: &T,
    cell_map: &MapRef,
) -> Option<String> {
    let formula = match cell_map.get(txn, KEY_FORMULA) {
        Some(Out::Any(Any::String(s))) => s.to_string(),
        _ => return None,
    };
    formula_hyperlink_url(&formula)
}

pub(crate) fn write_formula_hyperlink_metadata(
    cell_map: &MapRef,
    txn: &mut TransactionMut<'_>,
    formula: Option<&str>,
) {
    if let Some(url) = formula.and_then(formula_hyperlink_url) {
        cell_map.insert(txn, KEY_HYPERLINK, Any::String(Arc::from(url)));
    }
}

fn formula_hyperlink_url(formula: &str) -> Option<String> {
    let ast = compute_parser::parse_formula(formula, None)
        .ok()?
        .into_inner();
    hyperlink_url_from_ast(&ast)
}

fn hyperlink_url_from_ast(ast: &ASTNode) -> Option<String> {
    match ast {
        ASTNode::Paren(inner) => hyperlink_url_from_ast(inner),
        ASTNode::Function { name, args } if is_hyperlink_function_name(name.as_ref()) => {
            let ASTNode::Text(url) = args.first()? else {
                return None;
            };
            if url.trim().is_empty() {
                None
            } else {
                Some(url.clone())
            }
        }
        _ => None,
    }
}

fn is_hyperlink_function_name(name: &str) -> bool {
    let normalized = name
        .strip_prefix("_xlfn.")
        .or_else(|| name.strip_prefix("_xlws."))
        .unwrap_or(name);
    normalized.eq_ignore_ascii_case("HYPERLINK")
}

#[cfg(test)]
mod tests {
    use super::formula_hyperlink_url;

    #[test]
    fn extracts_literal_hyperlink_target() {
        assert_eq!(
            formula_hyperlink_url(r#"HYPERLINK("https://example.com","Example")"#),
            Some("https://example.com".to_string())
        );
        assert_eq!(
            formula_hyperlink_url(r#"=hyperlink("mailto:a@example.com")"#),
            Some("mailto:a@example.com".to_string())
        );
    }

    #[test]
    fn rejects_non_literal_hyperlink_target() {
        assert_eq!(formula_hyperlink_url("HYPERLINK(A1,\"Example\")"), None);
        assert_eq!(
            formula_hyperlink_url(r#"CONCAT(HYPERLINK("https://example.com"))"#),
            None
        );
    }
}
