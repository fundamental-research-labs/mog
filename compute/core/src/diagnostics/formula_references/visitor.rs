use std::collections::HashSet;

use compute_parser::{ASTNode, AstVisitor, CellRefNode, ReferenceToken, ReferenceTokenClass};
use formula_types::{CellRef, Scope, StructuredRef, StructuredRefSpecifier};
use value_types::CellError;

use crate::mirror::CellMirror;

use super::edges::PendingEdge;
use super::sources::SourceFormula;
use super::types::{
    FormulaReferenceEdgeKind, FormulaReferenceEdgeStatus, FormulaReferenceTargetKind,
};

pub(super) fn collect_ast_edges(
    mirror: &CellMirror,
    source: &SourceFormula,
    tokens: &[ReferenceToken],
    ast_node: &ASTNode,
) -> Vec<PendingEdge> {
    let mut visitor = BrokenAstVisitor::new(mirror, source, tokens);
    visitor.visit(ast_node);
    visitor.edges
}

struct BrokenAstVisitor<'a> {
    mirror: &'a CellMirror,
    source: &'a SourceFormula,
    tokens: &'a [ReferenceToken],
    token_cursor: usize,
    lexical_bindings: Vec<HashSet<String>>,
    edges: Vec<PendingEdge>,
}

impl<'a> BrokenAstVisitor<'a> {
    fn new(
        mirror: &'a CellMirror,
        source: &'a SourceFormula,
        tokens: &'a [ReferenceToken],
    ) -> Self {
        Self {
            mirror,
            source,
            tokens,
            token_cursor: 0,
            lexical_bindings: Vec::new(),
            edges: Vec::new(),
        }
    }

    fn next_token(&mut self, classes: &[ReferenceTokenClass]) -> Option<&ReferenceToken> {
        let pos = self.tokens[self.token_cursor..]
            .iter()
            .position(|t| classes.contains(&t.class))?
            + self.token_cursor;
        self.token_cursor = pos + 1;
        self.tokens.get(pos)
    }

    fn is_bound(&self, name: &str) -> bool {
        self.lexical_bindings
            .iter()
            .rev()
            .any(|scope| scope.contains(&name.to_ascii_lowercase()))
    }
}

impl AstVisitor for BrokenAstVisitor<'_> {
    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        if name.eq_ignore_ascii_case("LET") {
            let mut scope = HashSet::new();
            let mut i = 0usize;
            while i + 1 < args.len() {
                if let ASTNode::Identifier(binding) = &args[i] {
                    scope.insert(binding.to_ascii_lowercase());
                } else {
                    self.visit(&args[i]);
                }
                self.lexical_bindings.push(scope.clone());
                self.visit(&args[i + 1]);
                self.lexical_bindings.pop();
                i += 2;
            }
            if let Some(body) = args.last() {
                self.lexical_bindings.push(scope);
                self.visit(body);
                self.lexical_bindings.pop();
            }
            return;
        }
        if name.eq_ignore_ascii_case("LAMBDA") && !args.is_empty() {
            let mut scope = HashSet::new();
            for arg in &args[..args.len() - 1] {
                if let ASTNode::Identifier(binding) = arg {
                    scope.insert(binding.to_ascii_lowercase());
                }
            }
            self.lexical_bindings.push(scope);
            self.visit(&args[args.len() - 1]);
            self.lexical_bindings.pop();
            return;
        }
        for arg in args {
            self.visit(arg);
        }
    }

    fn visit_error(&mut self, _e: &CellError) {
        // Authored #REF! forms are emitted from the pre-AST token pass so
        // each diagnostic keeps the exact source span and occurrence index.
    }

    fn visit_unresolved_sheet_ref(&mut self, sheet_name: &str, inner: &ASTNode) {
        if let Some(token) = self.next_token(&[
            ReferenceTokenClass::SheetRef,
            ReferenceTokenClass::BrokenRef,
            ReferenceTokenClass::CellOrRange,
        ]) {
            let mut edge = PendingEdge::from_token(
                token,
                FormulaReferenceEdgeKind::DeletedSheet,
                FormulaReferenceTargetKind::Sheet,
                FormulaReferenceEdgeStatus::Missing,
                "referenced sheet does not exist".to_string(),
            );
            edge.target_display = Some(sheet_name.to_string());
            self.edges.push(edge);
        }
        self.visit(inner);
    }

    fn visit_unresolved_three_d_ref(&mut self, start_name: &str, end_name: &str, inner: &ASTNode) {
        if let Some(token) = self.next_token(&[ReferenceTokenClass::SheetRef]) {
            let mut edge = PendingEdge::from_token(
                token,
                FormulaReferenceEdgeKind::DeletedSheet,
                FormulaReferenceTargetKind::Sheet,
                FormulaReferenceEdgeStatus::Missing,
                "3-D sheet span does not resolve".to_string(),
            );
            edge.target_display = Some(format!("{start_name}:{end_name}"));
            self.edges.push(edge);
        }
        self.visit(inner);
    }

    fn visit_cell_ref(&mut self, r: &CellRefNode) {
        if let CellRef::Resolved(id) = &r.reference
            && self.mirror.resolve_position(id).is_none()
            && let Some(token) = self.next_token(&[ReferenceTokenClass::CellOrRange])
        {
            let mut edge = PendingEdge::from_token(
                token,
                FormulaReferenceEdgeKind::DanglingIdentityTarget,
                FormulaReferenceTargetKind::Cell,
                FormulaReferenceEdgeStatus::Deleted,
                "cell identity target no longer has a position".to_string(),
            );
            edge.target_cell_id = Some(*id);
            edge.target_sheet_id = self.mirror.sheet_for_cell(id);
            self.edges.push(edge);
        }
    }

    fn visit_identifier(&mut self, name: &str) {
        if self.is_bound(name) {
            return;
        }
        let chain = match self.source.sheet_id {
            Some(sheet) => vec![Scope::Sheet(sheet), Scope::Workbook],
            None => vec![Scope::Workbook],
        };
        if self.mirror.resolve_variable(name, &chain).is_some() {
            return;
        }
        if let Some(token) = self.next_token(&[ReferenceTokenClass::Name]) {
            let mut edge = PendingEdge::from_token(
                token,
                FormulaReferenceEdgeKind::MissingName,
                FormulaReferenceTargetKind::Name,
                FormulaReferenceEdgeStatus::Missing,
                "identifier is not a LET/LAMBDA binding, function, sheet-scoped name, or workbook name"
                    .to_string(),
            );
            edge.target_display = Some(name.to_string());
            self.edges.push(edge);
        }
    }

    fn visit_structured_ref(&mut self, r: &StructuredRef) {
        let Some(table) = self.mirror.get_table(&r.table_name) else {
            if let Some(token) = self.next_token(&[ReferenceTokenClass::StructuredRef]) {
                let mut edge = PendingEdge::from_token(
                    token,
                    FormulaReferenceEdgeKind::InvalidStructuredReference,
                    FormulaReferenceTargetKind::Table,
                    FormulaReferenceEdgeStatus::Missing,
                    "structured reference table is missing".to_string(),
                );
                edge.target_display = Some(r.table_name.clone());
                self.edges.push(edge);
            }
            return;
        };
        for spec in &r.specifiers {
            match spec {
                StructuredRefSpecifier::Column { name } => {
                    if !table.columns.iter().any(|c| c.name == *name)
                        && let Some(token) = self.next_token(&[ReferenceTokenClass::StructuredRef])
                    {
                        let mut edge = PendingEdge::from_token(
                            token,
                            FormulaReferenceEdgeKind::InvalidStructuredReference,
                            FormulaReferenceTargetKind::Table,
                            FormulaReferenceEdgeStatus::Invalid,
                            "structured reference column is missing".to_string(),
                        );
                        edge.target_display = Some(r.table_name.clone());
                        edge.target_column_name = Some(name.clone());
                        self.edges.push(edge);
                    }
                }
                StructuredRefSpecifier::ColumnRange { start, end } => {
                    let start_ok = table.columns.iter().any(|c| c.name == *start);
                    let end_ok = table.columns.iter().any(|c| c.name == *end);
                    if (!start_ok || !end_ok)
                        && let Some(token) = self.next_token(&[ReferenceTokenClass::StructuredRef])
                    {
                        let mut edge = PendingEdge::from_token(
                            token,
                            FormulaReferenceEdgeKind::InvalidStructuredReference,
                            FormulaReferenceTargetKind::Table,
                            FormulaReferenceEdgeStatus::Invalid,
                            format!(
                                "structured reference column range invalid: start={start_ok}, end={end_ok}"
                            ),
                        );
                        edge.target_display = Some(r.table_name.clone());
                        edge.target_column_name = Some(format!("{start}:{end}"));
                        self.edges.push(edge);
                    }
                }
                StructuredRefSpecifier::ThisRow if self.source.row.is_none() => {
                    if let Some(token) = self.next_token(&[ReferenceTokenClass::StructuredRef]) {
                        let mut edge = PendingEdge::from_token(
                            token,
                            FormulaReferenceEdgeKind::InvalidStructuredReference,
                            FormulaReferenceTargetKind::Table,
                            FormulaReferenceEdgeStatus::Invalid,
                            "ThisRow structured reference has no row context".to_string(),
                        );
                        edge.target_display = Some(r.table_name.clone());
                        self.edges.push(edge);
                    }
                }
                _ => {}
            }
        }
    }
}
