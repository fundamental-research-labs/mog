use cell_types::{CellId, SheetId, SheetPos};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::mirror::{CellMirror, MirrorPositionLookup};

pub const FORMULA_TEXT_DISPLAY_LIMIT: usize = 8192;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormulaTextLookup {
    Visible(String),
    NotFormula,
    Hidden,
    InvalidRef,
    Unavailable,
}

#[derive(Clone, Copy)]
pub struct FormulaTextProvider<'a> {
    cell_formula_text: Option<&'a FxHashMap<CellId, String>>,
    formula_strings: Option<&'a FxHashMap<CellId, String>>,
}

impl<'a> FormulaTextProvider<'a> {
    pub fn new(
        cell_formula_text: &'a FxHashMap<CellId, String>,
        formula_strings: &'a FxHashMap<CellId, String>,
    ) -> Self {
        Self {
            cell_formula_text: Some(cell_formula_text),
            formula_strings: Some(formula_strings),
        }
    }

    pub fn mirror_identity_only_for_test_unavailable() -> Self {
        Self {
            cell_formula_text: None,
            formula_strings: None,
        }
    }

    pub fn lookup(
        &self,
        mirror: &CellMirror,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> FormulaTextLookup {
        if mirror.get_sheet(sheet).is_none() {
            return FormulaTextLookup::InvalidRef;
        }

        let Some(cell_id) = mirror.resolve_cell_id(sheet, SheetPos::new(row, col)) else {
            return FormulaTextLookup::NotFormula;
        };

        if let Some(text) = self
            .cell_formula_text
            .and_then(|m| m.get(&cell_id))
            .or_else(|| self.formula_strings.and_then(|m| m.get(&cell_id)))
        {
            return visible_or_unavailable(text);
        }

        if let Some(formula) = mirror.get_formula(&cell_id) {
            let lookup = MirrorPositionLookup::new(mirror, *sheet);
            let text = compute_parser::to_a1_string(formula, &lookup);
            return visible_or_unavailable(&text);
        }

        FormulaTextLookup::NotFormula
    }
}

fn visible_or_unavailable(text: &str) -> FormulaTextLookup {
    if text.chars().count() > FORMULA_TEXT_DISPLAY_LIMIT {
        FormulaTextLookup::Unavailable
    } else {
        FormulaTextLookup::Visible(text.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum FormulaTextDepTarget {
    Cell(CellId),
    PosTopLeft {
        sheet: SheetId,
        row: u32,
        col: u32,
    },
    NameBinding {
        scope: formula_types::Scope,
        name: String,
    },
}

#[derive(Debug, Default)]
pub struct FormulaTextDepIndex {
    by_formula: FxHashMap<CellId, Vec<FormulaTextDepTarget>>,
    dependents_by_target: FxHashMap<FormulaTextDepTarget, FxHashSet<CellId>>,
}

impl FormulaTextDepIndex {
    pub fn replace(&mut self, formula_cell: CellId, targets: Vec<FormulaTextDepTarget>) {
        self.clear_formula(&formula_cell);
        if targets.is_empty() {
            return;
        }

        let mut seen = FxHashSet::with_capacity_and_hasher(targets.len(), Default::default());
        let mut deduped = Vec::with_capacity(targets.len());
        for target in targets {
            if seen.insert(target.clone()) {
                self.dependents_by_target
                    .entry(target.clone())
                    .or_default()
                    .insert(formula_cell);
                deduped.push(target);
            }
        }
        self.by_formula.insert(formula_cell, deduped);
    }

    pub fn clear_formula(&mut self, formula_cell: &CellId) {
        let Some(old_targets) = self.by_formula.remove(formula_cell) else {
            return;
        };
        for target in old_targets {
            if let Some(dependents) = self.dependents_by_target.get_mut(&target) {
                dependents.remove(formula_cell);
                if dependents.is_empty() {
                    self.dependents_by_target.remove(&target);
                }
            }
        }
    }

    pub fn clear_all(&mut self) {
        self.by_formula.clear();
        self.dependents_by_target.clear();
    }

    pub fn mark_changed(&self, target: &FormulaTextDepTarget, out: &mut FxHashSet<CellId>) {
        if let Some(dependents) = self.dependents_by_target.get(target) {
            out.extend(dependents.iter().copied());
        }
    }
}
