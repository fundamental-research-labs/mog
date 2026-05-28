//! Epoch-scoped subexpression cache for array-producing function arguments.
//!
//! When multiple cells call `SMALL(IF(same_condition, same_range), k)` for
//! different `k` values, the `IF(...)` subexpression is re-evaluated identically
//! each time. This cache deduplicates those evaluations within a recalc epoch.
//!
//! ## Cache tier
//!
//! **Tier 2 (epoch-scoped)**: Values depend on the current dirty-cell state and
//! MUST be invalidated at every recalc epoch boundary.  This cache will be
//! consolidated into a shared epoch cache when the evaluator is refactored to
//! thread an epoch cache reference through the evaluation call stack (touches
//! evaluator.rs, eval_primitives.rs, and call sites).  Until then, the
//! thread-local implementation here is correct for single-threaded evaluation.
//!
//! ## Cache key
//!
//! FxHash of the full AST subtree structure. On hit, the stored AST is compared
//! via `PartialEq` for collision safety (same pattern as `sorted_cache`).
//!
//! ## Lifetime
//!
//! Thread-local, cleared explicitly at recalc entry via `clear()`.

use std::cell::RefCell;
use std::hash::{Hash, Hasher};

use compute_functions::helpers::VOLATILE_FUNCTIONS;
#[cfg(test)]
use compute_parser::AbsFlags;
use compute_parser::{ASTNode, AstVisitor, BinOp, CellRefNode, RangeRef, UnaryOp};
use formula_types::{StructuredRef, StructuredRefSpecifier};
use rustc_hash::{FxHashMap, FxHasher};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Cache storage
// ---------------------------------------------------------------------------

struct SubexprCacheEntry {
    /// The AST subtree — kept for collision verification via PartialEq.
    ast: ASTNode,
    /// The evaluated array result.
    value: CellValue,
}

thread_local! {
    static SUBEXPR_CACHE: RefCell<FxHashMap<u64, SubexprCacheEntry>> =
        RefCell::new(FxHashMap::default());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Check if a subexpression is worth caching and safe to cache.
///
/// Returns `false` for trivial leaves (not worth caching) and for subtrees
/// containing volatile functions, position-dependent nullary functions
/// (`ROW()`/`COLUMN()` without args), identifiers, or unresolved sheet refs.
pub(in crate::eval) fn is_cacheable(node: &ASTNode) -> bool {
    match node {
        ASTNode::Number(_)
        | ASTNode::Text(_)
        | ASTNode::Boolean(_)
        | ASTNode::Error(_)
        | ASTNode::CellReference(_)
        | ASTNode::Range(_)
        | ASTNode::StructuredRef(_)
        | ASTNode::OptionalLambdaParam(_)
        | ASTNode::Omitted => return false,
        _ => {}
    }
    is_subtree_safe(node)
}

/// Compute a content hash of an AST subtree.
pub(in crate::eval) fn hash_ast(node: &ASTNode) -> u64 {
    let mut hasher = FxHasher::default();
    hash_node(node, &mut hasher);
    hasher.finish()
}

/// Look up a cached evaluation result. Returns `Some(value.clone())` on hit.
pub(in crate::eval) fn get(key: u64, ast: &ASTNode) -> Option<CellValue> {
    SUBEXPR_CACHE.with(|cache| {
        let c = cache.borrow();
        if let Some(entry) = c.get(&key)
            && entry.ast == *ast
        {
            return Some(entry.value.clone());
        }
        None
    })
}

/// Insert an evaluated result into the cache.
pub(in crate::eval) fn insert(key: u64, ast: ASTNode, value: CellValue) {
    SUBEXPR_CACHE.with(|cache| {
        cache
            .borrow_mut()
            .insert(key, SubexprCacheEntry { ast, value });
    });
}

/// Clear the cache. Must be called at recalc entry to prevent stale data
/// from a previous epoch being reused.
pub fn clear() {
    SUBEXPR_CACHE.with(|cache| cache.borrow_mut().clear());
}

/// Return the number of entries currently in the thread-local cache.
///
/// Used for diagnostics.
#[allow(dead_code)]
pub fn entry_count() -> usize {
    SUBEXPR_CACHE.with(|cache| cache.borrow().len())
}

// ---------------------------------------------------------------------------
// Safety predicate (recursive)
// ---------------------------------------------------------------------------

fn is_subtree_safe(node: &ASTNode) -> bool {
    let mut checker = SubtreeSafetyChecker { safe: true };
    checker.visit(node);
    checker.safe
}

struct SubtreeSafetyChecker {
    safe: bool,
}

impl AstVisitor for SubtreeSafetyChecker {
    fn visit(&mut self, node: &ASTNode) {
        if !self.safe {
            return; // short-circuit
        }
        self.walk(node);
    }

    fn visit_identifier(&mut self, _name: &str) {
        // Identifiers are context-dependent (LET/LAMBDA vars, named ranges)
        self.safe = false;
    }

    fn visit_unresolved_sheet_ref(&mut self, _name: &str, _inner: &ASTNode) {
        // Unresolved sheet refs could fail differently per context
        self.safe = false;
    }

    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        let upper = name.to_ascii_uppercase();
        // Reject volatile functions
        if VOLATILE_FUNCTIONS.contains(&upper.as_str()) {
            self.safe = false;
            return;
        }
        // ROW() / COLUMN() without args → position-dependent
        if (upper == "ROW" || upper == "COLUMN") && args.is_empty() {
            self.safe = false;
            return;
        }
        for arg in args {
            self.visit(arg);
        }
    }
}

// ---------------------------------------------------------------------------
// AST hasher (recursive)
// ---------------------------------------------------------------------------

fn hash_node(node: &ASTNode, h: &mut FxHasher) {
    // Discriminant tag — ensures different variants never collide.
    let tag: u8 = match node {
        ASTNode::Number(_) => 0,
        ASTNode::Text(_) => 1,
        ASTNode::Boolean(_) => 2,
        ASTNode::Error(_) => 3,
        ASTNode::CellReference(_) => 4,
        ASTNode::Range(_) => 5,
        ASTNode::SheetRef { .. } => 6,
        ASTNode::UnresolvedSheetRef { .. } => 7,
        ASTNode::StructuredRef(_) => 8,
        ASTNode::BinaryOp { .. } => 9,
        ASTNode::UnaryOp { .. } => 10,
        ASTNode::Function { .. } => 11,
        ASTNode::Paren(_) => 12,
        ASTNode::Identifier(_) => 13,
        ASTNode::OptionalLambdaParam(_) => 14,
        ASTNode::Array { .. } => 15,
        ASTNode::CallExpression { .. } => 16,
        ASTNode::Omitted => 17,
        ASTNode::RangeOp { .. } => 18,
        ASTNode::Union { .. } => 19,
        ASTNode::ThreeDRef { .. } => 20,
        ASTNode::UnresolvedThreeDRef { .. } => 21,
        ASTNode::ExternalSheetRef { .. } => 22,
        ASTNode::ExternalThreeDRef { .. } => 23,
        ASTNode::ExternalNameRef { .. } => 24,
    };
    tag.hash(h);

    match node {
        ASTNode::Number(n) => n.to_bits().hash(h),
        ASTNode::Text(s) => s.hash(h),
        ASTNode::Boolean(b) => b.hash(h),
        ASTNode::Error(e) => e.hash(h),

        ASTNode::CellReference(CellRefNode {
            reference,
            abs_row,
            abs_col,
        }) => {
            reference.hash(h);
            abs_row.hash(h);
            abs_col.hash(h);
        }

        ASTNode::Range(RangeRef {
            start,
            end,
            abs_start,
            abs_end,
            range_type,
        }) => {
            start.hash(h);
            end.hash(h);
            abs_start.row.hash(h);
            abs_start.col.hash(h);
            abs_end.row.hash(h);
            abs_end.col.hash(h);
            range_type.hash(h);
        }

        ASTNode::SheetRef { sheet, inner } => {
            sheet.hash(h);
            hash_node(inner, h);
        }
        ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
            sheet_name.hash(h);
            hash_node(inner, h);
        }

        ASTNode::StructuredRef(sr) => hash_structured_ref(sr, h),

        ASTNode::BinaryOp { op, left, right } => {
            hash_binop(*op, h);
            hash_node(left, h);
            hash_node(right, h);
        }
        ASTNode::UnaryOp { op, operand } => {
            hash_unaryop(*op, h);
            hash_node(operand, h);
        }

        ASTNode::Function { name, args } => {
            name.as_ref().hash(h);
            args.len().hash(h);
            for arg in args {
                hash_node(arg, h);
            }
        }

        ASTNode::Paren(inner) => hash_node(inner, h),
        ASTNode::Identifier(name) => name.hash(h),
        ASTNode::OptionalLambdaParam(name) => name.hash(h),

        ASTNode::Array { rows } => {
            rows.len().hash(h);
            for row in rows {
                row.len().hash(h);
                for cell in row {
                    hash_node(cell, h);
                }
            }
        }

        ASTNode::CallExpression { callee, args } => {
            hash_node(callee, h);
            args.len().hash(h);
            for arg in args {
                hash_node(arg, h);
            }
        }

        ASTNode::Omitted => {}

        ASTNode::RangeOp { start, end } => {
            hash_node(start, h);
            hash_node(end, h);
        }
        ASTNode::Union { ranges } => {
            ranges.len().hash(h);
            for range in ranges {
                hash_node(range, h);
            }
        }
        ASTNode::ThreeDRef {
            start_sheet,
            end_sheet,
            inner,
        } => {
            start_sheet.hash(h);
            end_sheet.hash(h);
            hash_node(inner, h);
        }
        ASTNode::UnresolvedThreeDRef {
            start_name,
            end_name,
            inner,
        } => {
            start_name.hash(h);
            end_name.hash(h);
            hash_node(inner, h);
        }
        ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner,
        } => {
            workbook.as_str().hash(h);
            sheet_name.hash(h);
            hash_node(inner, h);
        }
        ASTNode::ExternalThreeDRef {
            workbook,
            start_sheet,
            end_sheet,
            inner,
        } => {
            workbook.as_str().hash(h);
            start_sheet.hash(h);
            end_sheet.hash(h);
            hash_node(inner, h);
        }
        ASTNode::ExternalNameRef { workbook, name } => {
            workbook.as_str().hash(h);
            name.hash(h);
        }
    }
}

fn hash_binop(op: BinOp, h: &mut FxHasher) {
    let tag: u8 = match op {
        BinOp::Add => 0,
        BinOp::Sub => 1,
        BinOp::Mul => 2,
        BinOp::Div => 3,
        BinOp::Pow => 4,
        BinOp::Concat => 5,
        BinOp::Eq => 6,
        BinOp::Neq => 7,
        BinOp::Lt => 8,
        BinOp::Gt => 9,
        BinOp::Lte => 10,
        BinOp::Gte => 11,
        BinOp::Intersect => 12,
    };
    tag.hash(h);
}

fn hash_unaryop(op: UnaryOp, h: &mut FxHasher) {
    let tag: u8 = match op {
        UnaryOp::Plus => 0,
        UnaryOp::Minus => 1,
        UnaryOp::Percent => 2,
        UnaryOp::ImplicitIntersection => 3,
    };
    tag.hash(h);
}

fn hash_structured_ref(sr: &StructuredRef, h: &mut FxHasher) {
    sr.table_name.hash(h);
    sr.specifiers.len().hash(h);
    for spec in &sr.specifiers {
        match spec {
            StructuredRefSpecifier::Column { name } => {
                0u8.hash(h);
                name.hash(h);
            }
            StructuredRefSpecifier::ColumnRange { start, end } => {
                1u8.hash(h);
                start.hash(h);
                end.hash(h);
            }
            StructuredRefSpecifier::ThisRow => {
                2u8.hash(h);
            }
            StructuredRefSpecifier::Special { item } => {
                3u8.hash(h);
                item.hash(h);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::SheetId;
    use formula_types::{CellRef, RangeType};
    use value_types::CellError;

    fn pos(row: u32, col: u32) -> CellRef {
        CellRef::positional(SheetId::from_raw(0), row, col)
    }

    fn make_if_node() -> ASTNode {
        // IF($A$1:$A$100=$B$1, ROW($A$1:$A$100)-5)
        ASTNode::Function {
            name: "IF".into(),
            args: vec![
                ASTNode::BinaryOp {
                    op: BinOp::Eq,
                    left: Box::new(ASTNode::Range(RangeRef {
                        start: pos(0, 0),
                        end: pos(99, 0),
                        abs_start: AbsFlags {
                            row: true,
                            col: true,
                        },

                        abs_end: AbsFlags {
                            row: true,
                            col: true,
                        },
                        range_type: RangeType::CellRange,
                    })),
                    right: Box::new(ASTNode::CellReference(CellRefNode {
                        reference: pos(0, 1),
                        abs_row: true,
                        abs_col: true,
                    })),
                },
                ASTNode::BinaryOp {
                    op: BinOp::Sub,
                    left: Box::new(ASTNode::Function {
                        name: "ROW".into(),
                        args: vec![ASTNode::Range(RangeRef {
                            start: pos(0, 0),
                            end: pos(99, 0),
                            abs_start: AbsFlags {
                                row: true,
                                col: true,
                            },

                            abs_end: AbsFlags {
                                row: true,
                                col: true,
                            },
                            range_type: RangeType::CellRange,
                        })],
                    }),
                    right: Box::new(ASTNode::Number(5.0)),
                },
            ],
        }
    }

    #[test]
    fn test_is_cacheable_function_node() {
        let node = make_if_node();
        assert!(is_cacheable(&node));
    }

    #[test]
    fn test_is_cacheable_rejects_leaves() {
        assert!(!is_cacheable(&ASTNode::Number(42.0)));
        assert!(!is_cacheable(&ASTNode::Text("hello".into())));
        assert!(!is_cacheable(&ASTNode::Boolean(true)));
        assert!(!is_cacheable(&ASTNode::Error(CellError::Na)));
        assert!(!is_cacheable(&ASTNode::Omitted));
        assert!(!is_cacheable(&ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        })));
        assert!(!is_cacheable(&ASTNode::Range(RangeRef {
            start: pos(0, 0),
            end: pos(9, 0),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        })));
    }

    #[test]
    fn test_is_cacheable_rejects_volatile() {
        for name in &["RAND", "RANDBETWEEN", "NOW", "TODAY", "OFFSET", "INDIRECT"] {
            let node = ASTNode::Function {
                name: (*name).into(),
                args: vec![],
            };
            assert!(
                !is_cacheable(&node),
                "volatile function {} should not be cacheable",
                name
            );
        }
    }

    #[test]
    fn test_is_cacheable_rejects_nullary_row_column() {
        // ROW() without args — position-dependent
        let row_no_args = ASTNode::Function {
            name: "ROW".into(),
            args: vec![],
        };
        assert!(!is_cacheable(&row_no_args));

        // COLUMN() without args — position-dependent
        let col_no_args = ASTNode::Function {
            name: "COLUMN".into(),
            args: vec![],
        };
        assert!(!is_cacheable(&col_no_args));

        // ROW(A1:A100) with args — position-independent, cacheable
        let row_with_args = ASTNode::Function {
            name: "ROW".into(),
            args: vec![ASTNode::Range(RangeRef {
                start: pos(0, 0),
                end: pos(99, 0),
                abs_start: AbsFlags {
                    row: true,
                    col: true,
                },

                abs_end: AbsFlags {
                    row: true,
                    col: true,
                },
                range_type: RangeType::CellRange,
            })],
        };
        assert!(is_cacheable(&row_with_args));
    }

    #[test]
    fn test_is_cacheable_rejects_identifier() {
        let node = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Identifier("myRange".into())],
        };
        assert!(!is_cacheable(&node));
    }

    #[test]
    fn test_is_cacheable_rejects_nested_volatile() {
        // SUM(RAND()) — volatile buried in subtree
        let node = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Function {
                name: "RAND".into(),
                args: vec![],
            }],
        };
        assert!(!is_cacheable(&node));
    }

    #[test]
    fn test_hash_deterministic() {
        let node = make_if_node();
        let h1 = hash_ast(&node);
        let h2 = hash_ast(&node);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_differs_for_different_nodes() {
        let node_a = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Number(1.0)],
        };
        let node_b = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Number(2.0)],
        };
        assert_ne!(hash_ast(&node_a), hash_ast(&node_b));
    }

    #[test]
    fn test_hash_differs_for_different_functions() {
        let node_a = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Number(1.0)],
        };
        let node_b = ASTNode::Function {
            name: "AVERAGE".into(),
            args: vec![ASTNode::Number(1.0)],
        };
        assert_ne!(hash_ast(&node_a), hash_ast(&node_b));
    }

    #[test]
    fn test_cache_hit_and_miss() {
        clear();
        let node = make_if_node();
        let key = hash_ast(&node);

        // Miss
        assert!(get(key, &node).is_none());

        // Insert
        let array =
            CellValue::from_rows(vec![vec![CellValue::number(1.0), CellValue::number(2.0)]]);
        insert(key, node.clone(), array.clone());

        // Hit
        let cached = get(key, &node);
        assert!(cached.is_some());
        assert_eq!(cached.unwrap(), array);
    }

    #[test]
    fn test_clear_invalidates_cache() {
        clear();
        let node = make_if_node();
        let key = hash_ast(&node);
        let array = CellValue::from_rows(vec![vec![CellValue::number(1.0)]]);
        insert(key, node.clone(), array);

        clear();
        assert!(get(key, &node).is_none());
    }

    #[test]
    fn test_collision_safety_different_asts_same_hash_bucket() {
        clear();
        // Even if two ASTs were to collide on hash, the PartialEq check
        // prevents wrong results. We can verify the mechanism by inserting
        // one AST and querying with a different one that has the same key
        // (simulated by using the same key value).
        let node_a = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Number(1.0)],
        };
        let node_b = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Number(2.0)],
        };
        let key_a = hash_ast(&node_a);
        let array_a = CellValue::from_rows(vec![vec![CellValue::number(10.0)]]);
        insert(key_a, node_a.clone(), array_a);

        // Query with node_b using node_a's key — should miss due to PartialEq
        assert!(get(key_a, &node_b).is_none());
    }

    #[test]
    fn test_only_array_results_benefit() {
        // Verify scalar values can be stored (the insert doesn't filter),
        // but in practice the integration code only caches arrays.
        clear();
        let node = ASTNode::Function {
            name: "ABS".into(),
            args: vec![ASTNode::Number(-5.0)],
        };
        let key = hash_ast(&node);
        let scalar = CellValue::number(5.0);
        insert(key, node.clone(), scalar.clone());
        assert_eq!(get(key, &node), Some(scalar));
    }
}
