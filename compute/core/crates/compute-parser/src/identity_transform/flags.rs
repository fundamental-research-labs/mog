use crate::ast::ASTNode;
use crate::visitor::AstVisitor;

// ---------------------------------------------------------------------------
// Dynamic array / volatile function lists
// ---------------------------------------------------------------------------

/// Functions that produce dynamic arrays (spill ranges).
pub(super) const DYNAMIC_ARRAY_FUNCTIONS: &[&str] = &[
    "SEQUENCE",
    "SORT",
    "SORTBY",
    "FILTER",
    "UNIQUE",
    "RANDARRAY",
    "MAP",
    "MAKEARRAY",
    "BYROW",
    "BYCOL",
    "SCAN",
    "ANCHORARRAY",
    "SPLIT",
];

/// Functions whose results can change between recalculations without any
/// cell dependency changing.
///
/// **Canonical source:** `compute_functions::helpers::VOLATILE_FUNCTIONS`
/// (in `compute-core/crates/compute-functions/src/helpers/mod.rs`).
///
/// This is intentionally duplicated because `compute-parser` is a low-level
/// parsing crate that must not depend on `compute-functions`. When adding or
/// removing volatile functions, update **both** lists.
pub(super) const VOLATILE_FUNCTIONS: &[&str] = &[
    "NOW",
    "TODAY",
    "RAND",
    "RANDBETWEEN",
    "RANDARRAY",
    "INDIRECT",
    "OFFSET",
];

// ---------------------------------------------------------------------------
// Flag detection
// ---------------------------------------------------------------------------

/// AST visitor that detects dynamic-array and volatile function calls.
struct FlagDetector {
    is_dynamic: bool,
    is_volatile: bool,
}

impl AstVisitor for FlagDetector {
    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        if DYNAMIC_ARRAY_FUNCTIONS
            .iter()
            .any(|f| f.eq_ignore_ascii_case(name))
        {
            self.is_dynamic = true;
        }
        if VOLATILE_FUNCTIONS
            .iter()
            .any(|f| f.eq_ignore_ascii_case(name))
        {
            self.is_volatile = true;
        }
        // Continue recursion into children via default walk.
        for arg in args {
            self.visit(arg);
        }
    }
}

/// Walk the AST to detect dynamic-array and volatile function calls.
pub(super) fn check_ast_flags(node: &ASTNode) -> (bool, bool) {
    let mut detector = FlagDetector {
        is_dynamic: false,
        is_volatile: false,
    };
    detector.visit(node);
    (detector.is_dynamic, detector.is_volatile)
}

/// Return `true` iff the **top-level** call of `node` is `SUBTOTAL` or
/// `AGGREGATE` (matched case-insensitively on the function name, with the
/// XLSX-internal `_XLFN.` prefix tolerated).
///
/// Replaces the string-prefix shadow parser `formula_is_subtotal_or_aggregate`
/// (typed formula boundary). XLSX pipelines that call `normalize_xlsx_formula` before
/// parsing surface `_xlfn.SUBTOTAL(...)` as an `ASTNode::Function { name:
/// "SUBTOTAL", .. }`; paths that skip normalization may keep the prefix in
/// the function identifier, so we accept it here as well — matching the
/// old shadow parser's `strip_prefix("_XLFN.")` behavior.
///
/// **Top-level only**: `IF(TRUE, SUBTOTAL(1, A1:A10), 0)` returns `false`
/// because the top-level call is `IF`, matching the shadow parser's
/// `starts_with("SUBTOTAL(")` semantics. This is the behavior [`SUBTOTAL`]'s
/// skip-nested-aggregates rule relies on.
pub(super) fn top_level_is_aggregate(node: &ASTNode) -> bool {
    match node {
        ASTNode::Function { name, .. } => is_aggregate_name(name),
        _ => false,
    }
}

/// Match the (possibly `_xlfn.`-prefixed) function name against the aggregate
/// whitelist. Case-insensitive in both the prefix and the function identifier.
pub(super) fn is_aggregate_name(name: &str) -> bool {
    let stripped = name
        .strip_prefix("_xlfn.")
        .or_else(|| name.strip_prefix("_XLFN."))
        .or_else(|| {
            // Case-insensitive prefix strip for exotic casings (`_Xlfn.` etc.).
            // The len() >= 6 guard precedes every slice; the first 6 bytes
            // (if present) are `_xlfn.` / `_XLFN.` / `_Xlfn.` etc., all of
            // which are ASCII — char-boundary guaranteed at byte offset 6.
            if name.len() >= 6 {
                #[allow(clippy::string_slice)]
                let head = &name[..6];
                if head.eq_ignore_ascii_case("_xlfn.") {
                    #[allow(clippy::string_slice)]
                    let rest = &name[6..];
                    return Some(rest);
                }
            }
            None
        })
        .unwrap_or(name);
    stripped.eq_ignore_ascii_case("SUBTOTAL") || stripped.eq_ignore_ascii_case("AGGREGATE")
}
