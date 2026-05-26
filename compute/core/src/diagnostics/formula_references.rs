use std::collections::HashSet;

use cell_types::{CellId, SheetId};
use compute_parser::{ASTNode, AstVisitor, CellRefNode, ReferenceToken, ReferenceTokenClass};
use formula_types::{CellRef, Scope, StructuredRef, StructuredRefSpecifier};
use serde::{Deserialize, Serialize};
use value_types::CellError;

use crate::mirror::{CellMirror, SheetMirror};
use crate::range_manager::pos_to_a1;
use crate::scheduler::ComputeCore;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceDiagnosticsOptions {
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<SheetId>,
    #[serde(default)]
    pub include_warnings: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub external_links: ExternalLinkStatusSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkStatusSnapshot {
    pub version: String,
    #[serde(default)]
    pub records: Vec<ExternalLinkStatusSnapshotRecord>,
}

impl Default for ExternalLinkStatusSnapshot {
    fn default() -> Self {
        Self {
            version: "empty".to_string(),
            records: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkStatusSnapshotRecord {
    pub link_id: String,
    pub status: ExternalLinkStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<ExternalLinkStatusReason>,
    pub safe_display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLinkStatus {
    Unresolved,
    Loading,
    Ready,
    Stale,
    Denied,
    Broken,
    Ambiguous,
    Circular,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLinkStatusReason {
    WrongWorkbookId,
    MissingTarget,
    UnsupportedLinkKind,
    PermissionDenied,
    SourceUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceDiagnosticsPage {
    pub diagnostics: Vec<FormulaReferenceDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub snapshot_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum FormulaReferenceDiagnostic {
    ReferenceEdge(FormulaReferenceEdgeDiagnosticRow),
    Parse(FormulaReferenceParseDiagnosticRow),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceBaseDiagnostic {
    pub id: String,
    pub source_kind: FormulaReferenceSourceKind,
    pub severity: FormulaReferenceSeverity,
    pub code: String,
    pub location: FormulaReferenceLocation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceSourceKind {
    CellFormula,
    NamedRangeFormula,
    UnsupportedFormulaSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaReferenceSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceEdgeDiagnosticRow {
    #[serde(flatten)]
    pub base: FormulaReferenceBaseDiagnostic,
    pub kind: FormulaReferenceEdgeKind,
    pub edge: FormulaReferenceEdgeDiagnostic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceEdgeKind {
    DeletedCell,
    DeletedRange,
    DeletedSheet,
    MissingName,
    InvalidStructuredReference,
    UnresolvedExternalReference,
    ExternalReferenceWarning,
    DanglingIdentityTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceParseDiagnosticRow {
    #[serde(flatten)]
    pub base: FormulaReferenceBaseDiagnostic,
    pub kind: FormulaReferenceParseKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_start: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_end: Option<u32>,
    pub source_reason: FormulaReferenceParseSourceReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceParseKind {
    ParseError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceParseSourceReason {
    ParserError,
    IdentityTemplateOnly,
    UnsupportedSourceRepresentation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceLocation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<SheetId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_id: Option<CellId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub address_status: FormulaReferenceAddressStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceAddressStatus {
    Resolved,
    MissingPosition,
    NotCellBacked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceEdgeDiagnostic {
    pub edge_id: String,
    pub text: String,
    pub span_start: u32,
    pub span_end: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_index: Option<u32>,
    pub target_kind: FormulaReferenceTargetKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_display: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_sheet_id: Option<SheetId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_cell_id: Option<CellId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_name_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_table_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_column_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
    pub status: FormulaReferenceEdgeStatus,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaReferenceTargetKind {
    Cell,
    Range,
    Sheet,
    Name,
    Table,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaReferenceEdgeStatus {
    Missing,
    Deleted,
    Invalid,
    Unresolved,
    Loading,
    Stale,
    Denied,
    Broken,
    Ambiguous,
    Circular,
}

#[derive(Clone)]
struct SourceFormula {
    source_kind: FormulaReferenceSourceKind,
    source_stable_id: String,
    sheet_id: Option<SheetId>,
    cell_id: Option<CellId>,
    row: Option<u32>,
    col: Option<u32>,
    name: Option<String>,
    name_id: Option<String>,
    formula: String,
    order: SourceOrder,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SourceOrder {
    sheet_index: usize,
    row: u32,
    col: u32,
    source_rank: u8,
}

pub fn collect_formula_reference_diagnostics(
    mirror: &CellMirror,
    compute: &ComputeCore,
    options: FormulaReferenceDiagnosticsOptions,
) -> Result<FormulaReferenceDiagnosticsPage, value_types::ComputeError> {
    let limit = options.limit.unwrap_or(1000).clamp(1, 5000) as usize;
    let snapshot_version = snapshot_version(
        compute,
        &options.document_id,
        &options.external_links.version,
    );
    let start = decode_cursor(options.cursor.as_deref(), &snapshot_version)?;
    let mut sources = collect_sources(mirror, compute, &options.document_id, options.sheet_id);
    sources.sort_by_key(|s| s.order);

    let mut rows = Vec::new();
    for source in &sources {
        collect_source_rows(mirror, source, &options, &snapshot_version, &mut rows);
    }
    rows.sort_by_key(sort_key);

    let total = rows.len();
    let diagnostics = rows.into_iter().skip(start).take(limit).collect::<Vec<_>>();
    let next = start + diagnostics.len();
    let next_cursor = (next < total).then(|| encode_cursor(&snapshot_version, next));
    Ok(FormulaReferenceDiagnosticsPage {
        diagnostics,
        next_cursor,
        snapshot_version,
    })
}

fn collect_sources(
    mirror: &CellMirror,
    compute: &ComputeCore,
    document_id: &str,
    sheet_filter: Option<SheetId>,
) -> Vec<SourceFormula> {
    let mut sources = Vec::new();
    let ordered: Vec<SheetId> = compute.ordered_sheets_for_diagnostics().to_vec();
    for (sheet_index, sheet_id) in ordered.iter().enumerate() {
        if sheet_filter.is_some_and(|filter| filter != *sheet_id) {
            continue;
        }
        let Some(sheet) = mirror.get_sheet(sheet_id) else {
            continue;
        };
        collect_sheet_sources(sheet, compute, document_id, sheet_index, &mut sources);
    }

    if sheet_filter.is_none() {
        for (scope, name, def) in mirror.all_named_ranges_for_diagnostics() {
            let formula = def.raw_expression.as_ref().map_or_else(
                || render_identity_template(&def.refers_to.template),
                Clone::clone,
            );
            if formula.trim().is_empty() {
                continue;
            }
            sources.push(SourceFormula {
                source_kind: FormulaReferenceSourceKind::NamedRangeFormula,
                source_stable_id: format!("{document_id}:{scope:?}:{name}"),
                sheet_id: match scope {
                    Scope::Sheet(sid) => Some(*sid),
                    Scope::Workbook => None,
                },
                cell_id: None,
                row: None,
                col: None,
                name: Some(name.clone()),
                name_id: Some(format!("{document_id}:{scope:?}:{name}")),
                formula,
                order: SourceOrder {
                    sheet_index: usize::MAX - 1,
                    row: u32::MAX,
                    col: u32::MAX,
                    source_rank: 1,
                },
            });
        }
    }
    sources
}

fn collect_sheet_sources(
    sheet: &SheetMirror,
    compute: &ComputeCore,
    document_id: &str,
    sheet_index: usize,
    sources: &mut Vec<SourceFormula>,
) {
    let mut cells: Vec<_> = sheet.cells_iter().collect();
    cells.sort_by_key(|(cell_id, _)| {
        sheet
            .position_for_diagnostics(cell_id)
            .map_or((u32::MAX, u32::MAX), |p| (p.row(), p.col()))
    });
    for (cell_id, entry) in cells {
        if entry.formula.is_none() {
            continue;
        }
        let Some(pos) = sheet.position_for_diagnostics(cell_id) else {
            continue;
        };
        let Some(formula) = compute.get_formula(cell_id) else {
            continue;
        };
        sources.push(SourceFormula {
            source_kind: FormulaReferenceSourceKind::CellFormula,
            source_stable_id: format!("{document_id}:{}", cell_id.to_uuid_string()),
            sheet_id: Some(sheet.id),
            cell_id: Some(*cell_id),
            row: Some(pos.row()),
            col: Some(pos.col()),
            name: None,
            name_id: None,
            formula: normalize_display_formula(formula),
            order: SourceOrder {
                sheet_index,
                row: pos.row(),
                col: pos.col(),
                source_rank: 0,
            },
        });
    }
}

fn collect_source_rows(
    mirror: &CellMirror,
    source: &SourceFormula,
    options: &FormulaReferenceDiagnosticsOptions,
    snapshot_version: &str,
    rows: &mut Vec<FormulaReferenceDiagnostic>,
) {
    let formula = normalize_display_formula(&source.formula);
    let tokens = compute_parser::collect_reference_tokens(&formula);
    let parsed =
        compute_parser::parse_formula(&formula, Some(&DiagnosticResolver { mirror, source }));
    match parsed {
        Ok(ast) => {
            let mut visitor = BrokenAstVisitor::new(mirror, source, &tokens);
            visitor.visit(&ast.node);
            for edge in visitor.edges {
                push_edge(rows, source, snapshot_version, edge);
            }
        }
        Err(err) => rows.push(parse_row(
            source,
            snapshot_version,
            Some(err.span.start.saturating_add(1)),
            Some(err.span.end.saturating_add(1)),
            FormulaReferenceParseSourceReason::ParserError,
        )),
    }

    for token in tokens
        .iter()
        .filter(|t| t.class == ReferenceTokenClass::BrokenRef)
    {
        push_edge(
            rows,
            source,
            snapshot_version,
            PendingEdge::from_token(
                token,
                FormulaReferenceEdgeKind::DeletedCell,
                FormulaReferenceTargetKind::Cell,
                FormulaReferenceEdgeStatus::Deleted,
                "authored #REF! token".to_string(),
            ),
        );
    }

    for link in &options.external_links.records {
        if link.status == ExternalLinkStatus::Ready {
            continue;
        }
        let Some(token) = tokens
            .iter()
            .find(|t| {
                t.class == ReferenceTokenClass::ExternalRef
                    && t.text.contains(&link.safe_display_name)
            })
            .or_else(|| {
                tokens
                    .iter()
                    .find(|t| t.class == ReferenceTokenClass::ExternalRef)
            })
        else {
            continue;
        };
        let (kind, severity, status) = external_mapping(link);
        if severity == FormulaReferenceSeverity::Warning && !options.include_warnings {
            continue;
        }
        let mut edge = PendingEdge::from_token(
            token,
            kind,
            FormulaReferenceTargetKind::External,
            status,
            link.status_reason
                .map_or_else(|| format!("{:?}", link.status), |r| format!("{r:?}")),
        );
        edge.severity = severity;
        edge.link_id = Some(link.link_id.clone());
        edge.target_display = Some(if link.status == ExternalLinkStatus::Denied {
            "Access denied external reference".to_string()
        } else {
            link.safe_display_name.clone()
        });
        push_edge(rows, source, snapshot_version, edge);
    }
}

struct DiagnosticResolver<'a> {
    mirror: &'a CellMirror,
    source: &'a SourceFormula,
}

impl compute_parser::CellRefResolver for DiagnosticResolver<'_> {
    fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef {
        self.mirror
            .resolve_cell_id(sheet, cell_types::SheetPos::new(row, col))
            .map_or(
                CellRef::Positional {
                    sheet: *sheet,
                    row,
                    col,
                },
                CellRef::Resolved,
            )
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.mirror.sheet_by_name(name)
    }

    fn current_sheet(&self) -> SheetId {
        self.source.sheet_id.unwrap_or_else(|| SheetId::from_raw(0))
    }
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

#[derive(Clone)]
struct PendingEdge {
    kind: FormulaReferenceEdgeKind,
    severity: FormulaReferenceSeverity,
    text: String,
    span_start: u32,
    span_end: u32,
    ref_index: Option<u32>,
    target_kind: FormulaReferenceTargetKind,
    target_display: Option<String>,
    target_sheet_id: Option<SheetId>,
    target_cell_id: Option<CellId>,
    target_name_id: Option<String>,
    target_table_id: Option<String>,
    target_column_name: Option<String>,
    link_id: Option<String>,
    status: FormulaReferenceEdgeStatus,
    reason: String,
}

impl PendingEdge {
    fn from_token(
        token: &ReferenceToken,
        kind: FormulaReferenceEdgeKind,
        target_kind: FormulaReferenceTargetKind,
        status: FormulaReferenceEdgeStatus,
        reason: String,
    ) -> Self {
        Self {
            kind,
            severity: FormulaReferenceSeverity::Error,
            text: token.text.clone(),
            span_start: token.span_start,
            span_end: token.span_end,
            ref_index: Some(token.ref_index),
            target_kind,
            target_display: None,
            target_sheet_id: None,
            target_cell_id: None,
            target_name_id: None,
            target_table_id: None,
            target_column_name: None,
            link_id: None,
            status,
            reason,
        }
    }
}

fn push_edge(
    rows: &mut Vec<FormulaReferenceDiagnostic>,
    source: &SourceFormula,
    snapshot_version: &str,
    pending: PendingEdge,
) {
    let span_start = pending.span_start.to_string();
    let span_end = pending.span_end.to_string();
    let ref_index = pending
        .ref_index
        .map_or_else(String::new, |v| v.to_string());
    let kind = format!("{:?}", pending.kind);
    let status = format!("{:?}", pending.status);
    let edge_id = stable_hash_parts(&[
        &source.source_stable_id,
        &source.formula,
        &span_start,
        &span_end,
        &pending.text,
        &ref_index,
    ]);
    let id = stable_hash_parts(&[
        snapshot_version,
        &source.source_stable_id,
        &span_start,
        &span_end,
        &pending.text,
        &kind,
        &status,
    ]);
    rows.push(FormulaReferenceDiagnostic::ReferenceEdge(
        FormulaReferenceEdgeDiagnosticRow {
            base: FormulaReferenceBaseDiagnostic {
                id,
                source_kind: source.source_kind,
                severity: pending.severity,
                code: edge_code(pending.kind).to_string(),
                location: location(source),
                formula: Some(normalize_display_formula(&source.formula)),
                display_value: None,
            },
            kind: pending.kind,
            edge: FormulaReferenceEdgeDiagnostic {
                edge_id,
                text: pending.text,
                span_start: pending.span_start,
                span_end: pending.span_end,
                ref_index: pending.ref_index,
                target_kind: pending.target_kind,
                target_display: pending.target_display,
                target_sheet_id: pending.target_sheet_id,
                target_cell_id: pending.target_cell_id,
                target_name_id: pending.target_name_id,
                target_table_id: pending.target_table_id,
                target_column_name: pending.target_column_name,
                link_id: pending.link_id,
                status: pending.status,
                reason: pending.reason,
            },
        },
    ));
}

fn parse_row(
    source: &SourceFormula,
    snapshot_version: &str,
    span_start: Option<u32>,
    span_end: Option<u32>,
    source_reason: FormulaReferenceParseSourceReason,
) -> FormulaReferenceDiagnostic {
    let span_start_hash = span_start.map_or_else(String::new, |v| v.to_string());
    let span_end_hash = span_end.map_or_else(String::new, |v| v.to_string());
    let id = stable_hash_parts(&[
        snapshot_version,
        &source.source_stable_id,
        &span_start_hash,
        &span_end_hash,
        "parse-error",
    ]);
    FormulaReferenceDiagnostic::Parse(FormulaReferenceParseDiagnosticRow {
        base: FormulaReferenceBaseDiagnostic {
            id,
            source_kind: source.source_kind,
            severity: FormulaReferenceSeverity::Error,
            code: "formula-reference.parse-error".to_string(),
            location: location(source),
            formula: Some(normalize_display_formula(&source.formula)),
            display_value: None,
        },
        kind: FormulaReferenceParseKind::ParseError,
        span_start,
        span_end,
        source_reason,
    })
}

fn location(source: &SourceFormula) -> FormulaReferenceLocation {
    FormulaReferenceLocation {
        sheet_id: source.sheet_id,
        cell_id: source.cell_id,
        address: source.row.zip(source.col).map(|(r, c)| pos_to_a1(r, c)),
        row: source.row,
        col: source.col,
        name_id: source.name_id.clone(),
        name: source.name.clone(),
        address_status: if source.cell_id.is_some() {
            FormulaReferenceAddressStatus::Resolved
        } else {
            FormulaReferenceAddressStatus::NotCellBacked
        },
    }
}

fn render_identity_template(template: &str) -> String {
    normalize_display_formula(template)
}

fn normalize_display_formula(formula: &str) -> String {
    if formula.starts_with('=') {
        formula.to_string()
    } else {
        format!("={formula}")
    }
}

fn snapshot_version(compute: &ComputeCore, document_id: &str, external_version: &str) -> String {
    let mut formulas: Vec<_> = compute
        .formula_texts_for_diagnostics()
        .map(|(cell, formula)| format!("{}={}", cell.to_uuid_string(), formula))
        .collect();
    formulas.sort();
    let mut parts = Vec::with_capacity(formulas.len() + 2);
    parts.push(document_id);
    parts.push(external_version);
    parts.extend(formulas.iter().map(String::as_str));
    stable_hash_parts(&parts)
}

fn encode_cursor(snapshot_version: &str, offset: usize) -> String {
    format!("{snapshot_version}:{offset}")
}

fn decode_cursor(
    cursor: Option<&str>,
    snapshot_version: &str,
) -> Result<usize, value_types::ComputeError> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    let Some((version, offset)) = cursor.rsplit_once(':') else {
        return stale_cursor();
    };
    if version != snapshot_version {
        return stale_cursor();
    }
    offset
        .parse::<usize>()
        .map_err(|_| value_types::ComputeError::Eval {
            message: "diagnostics.staleCursor".to_string(),
        })
}

fn stale_cursor<T>() -> Result<T, value_types::ComputeError> {
    Err(value_types::ComputeError::Eval {
        message: "diagnostics.staleCursor".to_string(),
    })
}

fn stable_hash_parts(parts: &[&str]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for part in parts {
        for byte in part.as_bytes().iter().copied().chain([0xff]) {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{hash:016x}")
}

fn edge_code(kind: FormulaReferenceEdgeKind) -> &'static str {
    match kind {
        FormulaReferenceEdgeKind::DeletedCell => "formula-reference.deleted-cell",
        FormulaReferenceEdgeKind::DeletedRange => "formula-reference.deleted-range",
        FormulaReferenceEdgeKind::DeletedSheet => "formula-reference.deleted-sheet",
        FormulaReferenceEdgeKind::MissingName => "formula-reference.missing-name",
        FormulaReferenceEdgeKind::InvalidStructuredReference => {
            "formula-reference.invalid-structured-reference"
        }
        FormulaReferenceEdgeKind::UnresolvedExternalReference => {
            "formula-reference.unresolved-external-reference"
        }
        FormulaReferenceEdgeKind::ExternalReferenceWarning => {
            "formula-reference.external-reference-warning"
        }
        FormulaReferenceEdgeKind::DanglingIdentityTarget => {
            "formula-reference.dangling-identity-target"
        }
    }
}

fn external_mapping(
    link: &ExternalLinkStatusSnapshotRecord,
) -> (
    FormulaReferenceEdgeKind,
    FormulaReferenceSeverity,
    FormulaReferenceEdgeStatus,
) {
    match link.status {
        ExternalLinkStatus::Loading => (
            FormulaReferenceEdgeKind::ExternalReferenceWarning,
            FormulaReferenceSeverity::Warning,
            FormulaReferenceEdgeStatus::Loading,
        ),
        ExternalLinkStatus::Stale => (
            FormulaReferenceEdgeKind::ExternalReferenceWarning,
            FormulaReferenceSeverity::Warning,
            FormulaReferenceEdgeStatus::Stale,
        ),
        ExternalLinkStatus::Ambiguous => (
            FormulaReferenceEdgeKind::ExternalReferenceWarning,
            FormulaReferenceSeverity::Warning,
            FormulaReferenceEdgeStatus::Ambiguous,
        ),
        ExternalLinkStatus::Denied => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Denied,
        ),
        ExternalLinkStatus::Broken => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Broken,
        ),
        ExternalLinkStatus::Circular => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Circular,
        ),
        ExternalLinkStatus::Unresolved | ExternalLinkStatus::Ready => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Unresolved,
        ),
    }
}

fn sort_key(row: &FormulaReferenceDiagnostic) -> (String, u32, u32, u8, u32, u32, String) {
    match row {
        FormulaReferenceDiagnostic::ReferenceEdge(r) => (
            r.base
                .location
                .sheet_id
                .map(|s| s.to_uuid_string())
                .unwrap_or_default(),
            r.base.location.row.unwrap_or(u32::MAX),
            r.base.location.col.unwrap_or(u32::MAX),
            0,
            r.edge.span_start,
            r.edge.span_end,
            r.edge.edge_id.clone(),
        ),
        FormulaReferenceDiagnostic::Parse(r) => (
            r.base
                .location
                .sheet_id
                .map(|s| s.to_uuid_string())
                .unwrap_or_default(),
            r.base.location.row.unwrap_or(u32::MAX),
            r.base.location.col.unwrap_or(u32::MAX),
            1,
            r.span_start.unwrap_or(u32::MAX),
            r.span_end.unwrap_or(u32::MAX),
            r.base.id.clone(),
        ),
    }
}
