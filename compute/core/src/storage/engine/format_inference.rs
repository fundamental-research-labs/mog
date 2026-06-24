use std::collections::HashSet;

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use domain_types::CellFormat;
use formula_types::IdentityFormulaRef;
use snapshot_types::MutationResult;
use value_types::{CellValue, ComputeError};

use super::{YrsComputeEngine, mutation, services};

impl YrsComputeEngine {
    /// cell does not already have a date format applied, write the
    /// suggested format code (e.g. `"M/d/yyyy"`, `"yyyy-mm-dd"`) into the
    /// per-cell number_format. This is the Rust-side replacement for the
    /// previous `cell-operations.ts` post-set `parseDateInput` shim — the
    /// kernel just calls `setCellsByPosition` and Rust handles the
    /// value/format pairing atomically.
    ///
    /// Skips entries where:
    /// - the parse did not produce a numeric value (e.g. plain text, formula);
    /// - the resulting value is not a date (parse_date_input returns None);
    /// - the cell already has any explicit non-General format from any layer
    ///   of the cascade (column/row/table/cell) — Excel parity: an
    ///   explicitly-formatted cell never silently changes format on input.
    ///   Only General cells are eligible for auto date-inference.
    pub(in crate::storage::engine) fn apply_inferred_date_formats(
        &mut self,
        candidates: &[(SheetId, u32, u32, String)],
    ) -> Result<(), ComputeError> {
        let locale = self.settings.locale.clone();
        let mut to_apply: Vec<(SheetId, u32, u32, String)> = Vec::new();

        for (sheet_id, row, col, text) in candidates {
            // 1. Skip formulas and apostrophe-prefixed literal text — those
            //    never round-trip through date detection.
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed.starts_with('=') || trimmed.starts_with('\'') {
                continue;
            }

            // 2. Cell must exist and currently hold a numeric value (the
            //    parse landed as a date serial). If the parser fell through
            //    to text or boolean, skip.
            let cell_value = self
                .mirror
                .get_cell_value_at(sheet_id, cell_types::SheetPos::new(*row, *col));
            if !matches!(cell_value, Some(value_types::CellValue::Number(_))) {
                continue;
            }

            // 3. Locale-aware date detection. Rust's internal parse_input_value
            //    is stricter than parse_date_input (no D/M/Y, no month-name
            //    fallbacks), so only act when *both* parsers agree — this
            //    avoids "looks like a date in the locale" applying to plain
            //    numbers that happen to be the same magnitude as a serial.
            let parsed = match compute_formats::parse_date_input(trimmed, &locale) {
                Some(p) => p,
                None => continue,
            };

            // 4. Skip if the cell already has a date format applied.
            let cell_id =
                match services::cell_editing::find_cell_id_at(&self.stores, sheet_id, *row, *col) {
                    Some(id) => id,
                    None => continue,
                };
            let cell_hex = id_to_hex(cell_id.as_u128());
            let table_fmt =
                services::resolve_structured_format_at_cell(&self.mirror, sheet_id, *row, *col);
            let effective = crate::storage::properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                *row,
                *col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            );
            // Auto date-inference only fires on cells whose effective format is
            // General. Any explicit format the user set — Number, Currency,
            // Date, Fraction, Percentage, Scientific, Custom, Text, Special,
            // Time, Accounting — is sticky and beats inference. (Excel
            // parity: an explicitly-formatted cell never silently changes
            // format on input.) Use `detect_format_type` for canonical
            // classification, matching the route taken in
            // `services::cell_editing::write_cell_value` when computing the
            // parser hint.
            let has_explicit_format = effective
                .number_format
                .as_deref()
                .map(compute_formats::detect_format_type)
                .is_some_and(|ft| ft != compute_formats::FormatType::General);
            if has_explicit_format {
                continue;
            }

            to_apply.push((*sheet_id, *row, *col, parsed.suggested_format));
        }

        if to_apply.is_empty() {
            return Ok(());
        }

        // Suppress observer rebroadcast for the format writes — these are
        // structural follow-ups to the value mutation that already fired its
        // own observer notification.
        let _guard = self.mutation.suppress_guard();
        for (sheet_id, row, col, fmt) in to_apply {
            let format = CellFormat {
                number_format: Some(fmt),
                ..Default::default()
            };
            services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                &sheet_id,
                &[(row, col, row, col)],
                &format,
            )?;
        }
        Ok(())
    }

    pub(in crate::storage::engine) fn apply_inferred_time_formats(
        &mut self,
        candidates: &[(SheetId, u32, u32, String)],
    ) -> Result<(), ComputeError> {
        let mut to_apply: Vec<(SheetId, u32, u32, String)> = Vec::new();
        let culture = self.settings.locale.clone();

        for (sheet_id, row, col, text) in candidates {
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed.starts_with('=') || trimmed.starts_with('\'') {
                continue;
            }

            if !matches!(
                self.mirror
                    .get_cell_value_at(sheet_id, cell_types::SheetPos::new(*row, *col)),
                Some(value_types::CellValue::Number(_))
            ) {
                continue;
            }

            let Some(format) = inferred_time_format(trimmed, &culture.name) else {
                continue;
            };

            let cell_id =
                match services::cell_editing::find_cell_id_at(&self.stores, sheet_id, *row, *col) {
                    Some(id) => id,
                    None => continue,
                };
            let cell_hex = id_to_hex(cell_id.as_u128());
            let table_fmt =
                services::resolve_structured_format_at_cell(&self.mirror, sheet_id, *row, *col);
            let effective = crate::storage::properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                *row,
                *col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            );
            let has_explicit_format = effective
                .number_format
                .as_deref()
                .is_some_and(is_non_general_number_format);
            if has_explicit_format {
                continue;
            }

            to_apply.push((*sheet_id, *row, *col, format.to_string()));
        }

        if to_apply.is_empty() {
            return Ok(());
        }

        let _guard = self.mutation.suppress_guard();
        for (sheet_id, row, col, fmt) in to_apply {
            let format = CellFormat {
                number_format: Some(fmt),
                ..Default::default()
            };
            services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                &sheet_id,
                &[(row, col, row, col)],
                &format,
            )?;
        }
        Ok(())
    }

    pub(in crate::storage::engine) fn apply_inferred_currency_formats(
        &mut self,
        candidates: &[(SheetId, u32, u32, String)],
    ) -> Result<(), ComputeError> {
        let mut to_apply: Vec<(SheetId, u32, u32, String)> = Vec::new();

        for (sheet_id, row, col, text) in candidates {
            let trimmed = text.trim();
            if trimmed.is_empty() || trimmed.starts_with('=') || trimmed.starts_with('\'') {
                continue;
            }

            if !matches!(
                self.mirror
                    .get_cell_value_at(sheet_id, cell_types::SheetPos::new(*row, *col)),
                Some(value_types::CellValue::Number(_))
            ) {
                continue;
            }

            let Some(format) = inferred_currency_format(trimmed) else {
                continue;
            };

            let cell_id =
                match services::cell_editing::find_cell_id_at(&self.stores, sheet_id, *row, *col) {
                    Some(id) => id,
                    None => continue,
                };
            let cell_hex = id_to_hex(cell_id.as_u128());
            let table_fmt =
                services::resolve_structured_format_at_cell(&self.mirror, sheet_id, *row, *col);
            let effective = crate::storage::properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                *row,
                *col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            );
            let has_explicit_format = effective
                .number_format
                .as_deref()
                .is_some_and(is_non_general_number_format);
            if has_explicit_format {
                continue;
            }

            to_apply.push((*sheet_id, *row, *col, format.to_string()));
        }

        if to_apply.is_empty() {
            return Ok(());
        }

        let _guard = self.mutation.suppress_guard();
        for (sheet_id, row, col, fmt) in to_apply {
            let format = CellFormat {
                number_format: Some(fmt),
                ..Default::default()
            };
            services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                &sheet_id,
                &[(row, col, row, col)],
                &format,
            )?;
        }
        Ok(())
    }

    pub(in crate::storage::engine) fn apply_inferred_percent_formats(
        &mut self,
        candidates: &[(SheetId, u32, u32, String)],
    ) -> Result<(), ComputeError> {
        let mut to_apply: Vec<(SheetId, u32, u32)> = Vec::new();

        for (sheet_id, row, col, text) in candidates {
            let trimmed = text.trim();
            if trimmed.is_empty()
                || trimmed.starts_with('=')
                || trimmed.starts_with('\'')
                || !trimmed.ends_with('%')
            {
                continue;
            }

            if !matches!(
                self.mirror
                    .get_cell_value_at(sheet_id, cell_types::SheetPos::new(*row, *col)),
                Some(value_types::CellValue::Number(_))
            ) {
                continue;
            }

            let cell_id =
                match services::cell_editing::find_cell_id_at(&self.stores, sheet_id, *row, *col) {
                    Some(id) => id,
                    None => continue,
                };
            let cell_hex = id_to_hex(cell_id.as_u128());
            let table_fmt =
                services::resolve_structured_format_at_cell(&self.mirror, sheet_id, *row, *col);
            let effective = crate::storage::properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                *row,
                *col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            );
            if effective
                .number_format
                .as_deref()
                .is_some_and(is_non_general_number_format)
            {
                continue;
            }

            to_apply.push((*sheet_id, *row, *col));
        }

        if to_apply.is_empty() {
            return Ok(());
        }

        let _guard = self.mutation.suppress_guard();
        for (sheet_id, row, col) in to_apply {
            let format = CellFormat {
                number_format: Some("0%".to_string()),
                ..Default::default()
            };
            services::formatting::set_format_for_ranges(
                &mut self.stores,
                &self.mirror,
                &sheet_id,
                &[(row, col, row, col)],
                &format,
            )?;
        }
        Ok(())
    }

    /// Excel applies formula-reference number format inheritance at edit time:
    /// the formula cell receives its own copied number_format, and later display
    /// reads use that stored format without walking references.
    pub(in crate::storage::engine) fn apply_formula_inherited_number_formats(
        &mut self,
        candidates: &[(SheetId, u32, u32)],
    ) -> Result<MutationResult, ComputeError> {
        if candidates.is_empty() {
            return Ok(MutationResult::empty());
        }

        let mut to_apply: Vec<(SheetId, u32, u32, String)> = Vec::new();

        for (sheet_id, row, col) in candidates {
            let Some(cell_id) = self
                .mirror
                .resolve_cell_id(sheet_id, SheetPos::new(*row, *col))
            else {
                continue;
            };

            if self.formula_cell_has_non_general_number_format(&cell_id, sheet_id, *row, *col) {
                continue;
            }

            let Some(formula) = self.mirror.get_formula(&cell_id) else {
                continue;
            };
            match formula_result_format_intent(&formula.template) {
                FormulaResultFormatIntent::Apply(format) => {
                    if !self.formula_cell_result_is_numeric(sheet_id, *row, *col) {
                        continue;
                    }
                    to_apply.push((*sheet_id, *row, *col, format.to_string()));
                    continue;
                }
                FormulaResultFormatIntent::Numeric | FormulaResultFormatIntent::NonInheriting => {
                    continue;
                }
                FormulaResultFormatIntent::InheritReference
                | FormulaResultFormatIntent::Unknown => {}
            }

            let mut visited = HashSet::new();
            visited.insert(cell_id);
            let Some(number_format) =
                self.inherited_formula_number_format(&cell_id, &mut visited, 8)
            else {
                continue;
            };

            to_apply.push((*sheet_id, *row, *col, number_format));
        }

        if to_apply.is_empty() {
            return Ok(MutationResult::empty());
        }

        let mut result = MutationResult::empty();
        let mut patch_blobs = Vec::new();
        for (sheet_id, row, col, number_format) in to_apply {
            let format = CellFormat {
                number_format: Some(number_format),
                ..Default::default()
            };
            let (affected, format_result) = {
                let _guard = self.mutation.suppress_guard();
                services::formatting::set_format_for_ranges(
                    &mut self.stores,
                    &self.mirror,
                    &sheet_id,
                    &[(row, col, row, col)],
                    &format,
                )?
            };
            result
                .property_changes
                .extend(format_result.property_changes);
            patch_blobs.push(self.produce_format_change_patches(&sheet_id, &affected));
        }

        if !patch_blobs.is_empty() {
            let patches = compute_wire::mutation::concat_multi_viewport_patches(&patch_blobs);
            self.mutation.pending_format_patches =
                Some(match self.mutation.pending_format_patches.take() {
                    Some(existing) => {
                        compute_wire::mutation::concat_multi_viewport_patches(&[existing, patches])
                    }
                    None => patches,
                });
        }

        Ok(result)
    }

    fn formula_cell_has_non_general_number_format(
        &self,
        cell_id: &CellId,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> bool {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let table_fmt =
            services::resolve_structured_format_at_cell(&self.mirror, sheet_id, row, col);
        let effective = crate::storage::properties::get_effective_format(
            &self.stores.storage,
            sheet_id,
            &cell_hex,
            row,
            col,
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(sheet_id),
            self.mirror.get_sheet(sheet_id),
        );

        effective
            .number_format
            .as_deref()
            .is_some_and(is_non_general_number_format)
    }

    fn formula_cell_result_is_numeric(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        matches!(
            self.mirror
                .get_cell_value_at(sheet_id, SheetPos::new(row, col)),
            Some(CellValue::Number(_))
        )
    }

    fn effective_number_format_for_cell(&self, cell_id: &CellId) -> Option<String> {
        let sheet_id = self.mirror.sheet_for_cell(cell_id)?;
        let pos = self.mirror.resolve_position(cell_id)?;
        let cell_hex = id_to_hex(cell_id.as_u128());
        let table_fmt = services::resolve_structured_format_at_cell(
            &self.mirror,
            &sheet_id,
            pos.row(),
            pos.col(),
        );
        let effective = crate::storage::properties::get_effective_format(
            &self.stores.storage,
            &sheet_id,
            &cell_hex,
            pos.row(),
            pos.col(),
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(&sheet_id),
            self.mirror.get_sheet(&sheet_id),
        );

        effective
            .number_format
            .filter(|fmt| is_non_general_number_format(fmt))
    }

    fn inherited_formula_number_format(
        &self,
        formula_cell_id: &CellId,
        visited: &mut HashSet<CellId>,
        depth: u8,
    ) -> Option<String> {
        if depth == 0 {
            return None;
        }

        let formula = self.mirror.get_formula(formula_cell_id)?;
        let mut inherited: Option<String> = None;

        for reference in &formula.refs {
            let IdentityFormulaRef::Cell(cell_ref) = reference else {
                continue;
            };

            let source_format = if let Some(format) =
                self.effective_number_format_for_cell(&cell_ref.id)
            {
                Some(format)
            } else if visited.insert(cell_ref.id) {
                let nested = self.inherited_formula_number_format(&cell_ref.id, visited, depth - 1);
                visited.remove(&cell_ref.id);
                nested
            } else {
                None
            };

            let Some(source_format) = source_format else {
                continue;
            };

            match &inherited {
                Some(existing) if existing != &source_format => return None,
                Some(_) => {}
                None => inherited = Some(source_format),
            }
        }

        inherited
    }
}

fn is_non_general_number_format(format: &str) -> bool {
    compute_formats::detect_format_type(format) != compute_formats::FormatType::General
}

fn inferred_time_format(text: &str, culture: &str) -> Option<&'static str> {
    crate::storage::cells::values::parse_time_string(text, culture)?;
    let lower = text.to_ascii_lowercase();
    let has_meridiem = lower.ends_with("am") || lower.ends_with("pm");
    let colon_count = text.as_bytes().iter().filter(|&&b| b == b':').count();
    Some(match (has_meridiem, colon_count >= 2) {
        (true, true) => "h:mm:ss AM/PM",
        (true, false) => "h:mm AM/PM",
        (false, true) => "h:mm:ss",
        (false, false) => "h:mm",
    })
}

fn inferred_currency_format(text: &str) -> Option<&'static str> {
    let has_currency = text
        .chars()
        .any(|ch| matches!(ch, '$' | '€' | '£' | '¥' | '₹' | '₽' | '¢' | '₩'));
    if !has_currency || !text.chars().any(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some("$#,##0.00")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FormulaResultFormatIntent {
    Apply(&'static str),
    Numeric,
    NonInheriting,
    InheritReference,
    Unknown,
}

fn formula_result_format_intent(template: &str) -> FormulaResultFormatIntent {
    let trimmed = template.trim();
    if trimmed.starts_with('{') {
        return FormulaResultFormatIntent::InheritReference;
    }
    let Some(root) = formula_root_name(trimmed) else {
        return FormulaResultFormatIntent::Unknown;
    };
    match root.as_str() {
        "DATE" | "EDATE" | "EOMONTH" | "NOW" | "TODAY" => {
            FormulaResultFormatIntent::Apply("M/d/yyyy")
        }
        "TIME" | "TIMEVALUE" => FormulaResultFormatIntent::Apply("h:mm"),
        "DATEVALUE" => FormulaResultFormatIntent::Numeric,
        "NETWORKDAYS" | "NETWORKDAYS.INTL" | "DAYS" | "DATEDIF"
            if date_difference_uses_simple_date_refs(trimmed) =>
        {
            FormulaResultFormatIntent::InheritReference
        }
        "NETWORKDAYS" | "NETWORKDAYS.INTL" | "DAYS" | "DATEDIF" => {
            FormulaResultFormatIntent::Numeric
        }
        "COUNT" | "COUNTA" | "COUNTBLANK" | "COUNTIF" | "COUNTIFS" | "SUM" | "SUMIF" | "SUMIFS"
        | "AVERAGE" | "AVERAGEIF" | "AVERAGEIFS" | "MIN" | "MAX" | "MEDIAN" | "MODE"
        | "MODE.SNGL" | "MODE.MULT" | "STDEV" | "STDEV.S" | "STDEV.P" | "VAR" | "VAR.S"
        | "VAR.P" => FormulaResultFormatIntent::Numeric,
        "TEXT" | "TEXTJOIN" | "CONCAT" | "CONCATENATE" | "LEFT" | "RIGHT" | "MID"
        | "TEXTBEFORE" | "TEXTAFTER" | "TEXTSPLIT" => FormulaResultFormatIntent::NonInheriting,
        _ => FormulaResultFormatIntent::Unknown,
    }
}

fn formula_root_name(template: &str) -> Option<String> {
    let mut end = 0;
    for (idx, ch) in template.char_indices() {
        if ch.is_ascii_alphabetic() || ch == '.' || ch == '_' {
            end = idx + ch.len_utf8();
            continue;
        }
        break;
    }
    if end == 0 || !template[end..].trim_start().starts_with('(') {
        return None;
    }
    let mut root = template[..end].to_ascii_uppercase();
    if let Some(stripped) = root.strip_prefix("_XLFN.") {
        root = stripped.to_string();
    }
    Some(root)
}

fn date_difference_uses_simple_date_refs(template: &str) -> bool {
    let Some(args) = top_level_formula_args(template) else {
        return false;
    };
    if args.len() < 2 {
        return false;
    }
    args.iter()
        .take(2)
        .all(|arg| is_simple_a1_cell_ref(arg.trim()))
}

fn top_level_formula_args(template: &str) -> Option<Vec<&str>> {
    let open = template.find('(')?;
    let close = template.rfind(')')?;
    if close <= open {
        return None;
    }

    let mut args = Vec::new();
    let mut start = open + 1;
    let mut depth = 0u32;
    let mut in_string = false;
    let bytes = template.as_bytes();
    let mut idx = start;

    while idx < close {
        let b = bytes[idx];
        if in_string {
            if b == b'"' {
                if idx + 1 < close && bytes[idx + 1] == b'"' {
                    idx += 2;
                    continue;
                }
                in_string = false;
            }
            idx += 1;
            continue;
        }

        match b {
            b'"' => in_string = true,
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                args.push(template[start..idx].trim());
                start = idx + 1;
            }
            _ => {}
        }
        idx += 1;
    }
    args.push(template[start..close].trim());
    Some(args)
}

fn is_simple_a1_cell_ref(value: &str) -> bool {
    if is_simple_identity_ref(value) {
        return true;
    }

    let reference = value
        .rsplit_once('!')
        .map(|(_, cell)| cell)
        .unwrap_or(value)
        .replace('$', "");
    let mut saw_col = false;
    let mut saw_row = false;
    let mut in_row = false;

    for ch in reference.chars() {
        if ch.is_ascii_alphabetic() && !in_row {
            saw_col = true;
            continue;
        }
        if ch.is_ascii_digit() {
            in_row = true;
            saw_row = true;
            continue;
        }
        return false;
    }

    saw_col && saw_row
}

fn is_simple_identity_ref(value: &str) -> bool {
    let Some(inner) = value.strip_prefix('{').and_then(|v| v.strip_suffix('}')) else {
        return false;
    };
    !inner.is_empty() && inner.chars().all(|ch| ch.is_ascii_digit())
}

pub(in crate::storage::engine) fn is_formula_parse_input(input: &mutation::CellInput) -> bool {
    matches!(input, mutation::CellInput::Parse { text } if text.trim().starts_with('='))
}
