use super::*;

fn is_orphan_ref(s: &str) -> bool {
    matches!(
        ParsedExpr::classify(s),
        ParsedExpr::BrokenRef { .. } | ParsedExpr::Empty
    )
}

mod broken_ref;
mod classify;
mod formula_source;
mod literal;
mod proptests;
mod serialize;
mod sqref;
