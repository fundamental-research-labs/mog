//! Viewport patch production for mutation results.
//!
//! After every mutation, the engine produces binary viewport patches for all
//! registered viewports that overlap with the mutation's changed cells.
//!
//! **Invariant**: Both [`produce_viewport_patches`] and
//! [`produce_viewport_patches_for_recalc`] call `enrich_display_text` and
//! `enrich_metadata_flags` before serializing, so callers never need to enrich
//! manually. This makes it architecturally impossible to produce patches with
//! missing display text or metadata flags.

use crate::storage::engine::{YrsComputeEngine, services};
use crate::storage::properties;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_wire::PaletteSnapshot;
use compute_wire::mutation::CfColorOverrides;
use domain_types::CellFormat;
use rustc_hash::{FxHashMap, FxHashSet};
use snapshot_types::RecalcResult;
use value_types::CellValue;

impl YrsComputeEngine {
    /// Build a [`CfColorOverrides`] map from the CF cache for a given sheet.
    pub(crate) fn build_cf_color_overrides(&self, sheet_id: &SheetId) -> Option<CfColorOverrides> {
        super::functions::build_cf_color_overrides(&self.stores, sheet_id)
    }

    /// Produce packed multi-viewport binary patches for all registered viewports
    /// whose sheet matches `mutation_sheet_id`.
    ///
    /// Enriches `display_text` on each changed cell before serializing so the
    /// binary wire format always includes pre-formatted text.
    pub(crate) fn produce_viewport_patches(
        &mut self,
        recalc: &mut RecalcResult,
        mutation_sheet_id: &SheetId,
        generation: u8,
    ) -> Vec<u8> {
        // Refresh CF cache for this sheet if it has CF rules and cells changed
        if self.stores.cf_cache.contains_key(mutation_sheet_id) && !recalc.changed_cells.is_empty()
        {
            self.refresh_cf_cache(mutation_sheet_id);
        }
        self.enrich_display_text(recalc);
        self.enrich_metadata_flags(recalc);

        // Enrich format_idx: value-only mutations produce CellChange with
        // format_idx = None. Without this step the serializer defaults None → 0,
        // clobbering the cell's format in the TS viewport buffer. Resolve the
        // effective format for each such cell and intern it into the palette.
        let (palette_len_before, palette_bytes) = {
            let mut palettes = self.viewport.format_palettes_mut();
            let palette = palettes.entry(*mutation_sheet_id).or_default();
            let palette_len_before = palette.len() as u16;
            let theme_palette = &self.settings.theme_palette;

            for change in &mut recalc.changed_cells {
                if change.format_idx.is_some() {
                    continue;
                }
                let sheet_id = match SheetId::from_uuid_str(&change.sheet_id) {
                    Ok(id) => id,
                    Err(_) => continue,
                };
                if sheet_id != *mutation_sheet_id {
                    continue;
                }
                let Some(pos) = change.position.clone() else {
                    continue;
                };
                let cell_hex = match CellId::from_uuid_str(&change.cell_id) {
                    Ok(cid) => id_to_hex(cid.as_u128()),
                    Err(_) => continue,
                };
                let table_fmt = services::tables::resolve_table_format_at_cell(
                    &self.mirror,
                    &sheet_id,
                    pos.row,
                    pos.col,
                );
                let mut effective = properties::get_effective_format(
                    &self.stores.storage,
                    &sheet_id,
                    &cell_hex,
                    pos.row,
                    pos.col,
                    table_fmt.as_ref(),
                    self.stores.grid_indexes.get(&sheet_id),
                    self.mirror.get_sheet(&sheet_id),
                );
                domain_types::theme_color::resolve_theme_refs(&mut effective, theme_palette);
                let idx = palette.intern(&effective).unwrap_or(0);
                change.format_idx = Some(idx);
            }

            // Build palette delta if new entries were interned.
            let delta_formats = palette.formats_since(palette_len_before);
            let palette_bytes = compute_wire::palette_binary::serialize_palette_binary(
                delta_formats,
                palette_len_before,
            );
            (palette_len_before, palette_bytes)
        };
        let palette_param = if palette_bytes.is_empty() {
            None
        } else {
            Some(PaletteSnapshot {
                start_index: palette_len_before,
                palette_bytes: palette_bytes.as_slice(),
            })
        };

        let sheet_id_str = mutation_sheet_id.to_uuid_string();
        let cf_colors = self.build_cf_color_overrides(mutation_sheet_id);
        let mut patches: Vec<(String, Vec<u8>)> = Vec::new();

        for (viewport_id, bounds) in self.viewport.viewports_for_sheet(mutation_sheet_id) {
            let patch = compute_wire::mutation::serialize_mutation_result_for_viewport(
                recalc,
                &sheet_id_str,
                generation,
                bounds,
                palette_param,
                cf_colors.as_ref(),
            );

            patches.push((viewport_id.to_string(), patch));
        }

        compute_wire::mutation::serialize_multi_viewport_patches(&patches)
    }

    /// Produce packed multi-viewport binary patches for format-only mutations.
    pub(crate) fn produce_format_viewport_patches(
        &self,
        recalc: &mut RecalcResult,
        mutation_sheet_id: &SheetId,
        palette_len_before: u16,
        palette_bytes: &[u8],
    ) -> Vec<u8> {
        self.enrich_display_text(recalc);
        self.enrich_metadata_flags(recalc);
        let sheet_id_str = mutation_sheet_id.to_uuid_string();
        let cf_colors = self.build_cf_color_overrides(mutation_sheet_id);
        let mut patches: Vec<(String, Vec<u8>)> = Vec::new();

        let palette_param = if palette_bytes.is_empty() {
            None
        } else {
            Some(PaletteSnapshot {
                start_index: palette_len_before,
                palette_bytes,
            })
        };

        for (viewport_id, bounds) in self.viewport.viewports_for_sheet(mutation_sheet_id) {
            let patch = compute_wire::mutation::serialize_mutation_result_for_viewport(
                recalc,
                &sheet_id_str,
                0,
                bounds,
                palette_param,
                cf_colors.as_ref(),
            );

            patches.push((viewport_id.to_string(), patch));
        }

        compute_wire::mutation::serialize_multi_viewport_patches(&patches)
    }

    /// Produce viewport patches for comment mutations.
    ///
    /// Delegates cell change construction to `build_comment_changed_cells`,
    /// then feeds through the standard `produce_viewport_patches` pipeline.
    pub(crate) fn produce_comment_viewport_patches(
        &mut self,
        sheet_id: &SheetId,
        cells: &[(u32, u32)],
        has_comment: bool,
    ) -> Vec<u8> {
        let changed_cells = super::functions::build_comment_changed_cells(
            &self.stores,
            &self.mirror,
            sheet_id,
            cells,
            has_comment,
        );

        let mut recalc = RecalcResult {
            changed_cells,
            ..RecalcResult::empty()
        };

        self.produce_viewport_patches(&mut recalc, sheet_id, 0)
    }

    /// Produce viewport patches for sparkline metadata mutations.
    ///
    /// The binary mutation path carries `HAS_SPARKLINE` in cell flags, so
    /// sparkline add/delete/move must patch visible cells even when no value
    /// changed.
    pub(crate) fn produce_sparkline_viewport_patches(
        &mut self,
        sheet_id: &SheetId,
        cells: &[(u32, u32)],
    ) -> Vec<u8> {
        let changed_cells = super::functions::build_sparkline_changed_cells(
            &self.stores,
            &self.mirror,
            sheet_id,
            cells,
        );

        let mut recalc = RecalcResult {
            changed_cells,
            ..RecalcResult::empty()
        };

        self.produce_viewport_patches(&mut recalc, sheet_id, 0)
    }

    /// Produce full viewport binary patches after a CF rule mutation.
    ///
    /// CF rule changes can alter the rendered appearance of any cell within the
    /// affected sheet. Rather than identifying individual changed cells, we
    /// rebuild the full viewport binary for every registered viewport on the
    /// given sheet.
    ///
    /// This is the generic full-rebuild path used by every mutation whose
    /// effect on the viewport buffer is broader than `recalc.changed_cells`:
    /// - CF rule add/update/delete/reorder (merge/style of cells outside the change set).
    /// - Sort with CF overlap (top-N / above-average / data-bar / color-scale).
    /// - Filter create/apply/clear (hidden-row layout state changes).
    /// - Structural insert/delete with CF coverage (CF range geometry shifts).
    /// - relocate_cells (clear of source positions + write of all target positions).
    pub(crate) fn produce_cf_viewport_patches(&mut self, sheet_id: &SheetId) -> Vec<u8> {
        self.produce_full_viewport_patches(sheet_id)
    }

    /// Generic full-viewport rebuild for a sheet.
    ///
    /// Renamed-but-otherwise-equal twin of `produce_cf_viewport_patches`.
    /// Use this name when the caller's intent isn't CF-specific (filter
    /// row-visibility, relocate clears, structural CF re-eval).
    pub(crate) fn produce_full_viewport_patches(&mut self, sheet_id: &SheetId) -> Vec<u8> {
        // Collect viewport IDs and bounds for the target sheet.
        // `viewports_for_sheet` already returns an owned Vec.
        let viewports: Vec<(String, compute_wire::ViewportBounds)> =
            self.viewport.viewports_for_sheet(sheet_id);

        let mut patches: Vec<(String, Vec<u8>)> = Vec::with_capacity(viewports.len());

        for (viewport_id, bounds) in &viewports {
            let render_data = self.build_viewport_render_data(
                sheet_id,
                bounds.start_row,
                bounds.start_col,
                bounds.end_row,
                bounds.end_col,
            );
            let patch =
                compute_wire::viewport::serialize_viewport_binary(&render_data, 0, false, 0);
            patches.push((viewport_id.clone(), patch));
        }

        compute_wire::mutation::serialize_multi_viewport_patches(&patches)
    }

    /// Produce targeted viewport patches for row/column format mutations.
    ///
    /// Row/column formats affect virtual cells too, so this cannot enumerate
    /// only allocated cell IDs. Instead, synthesize format changes for the
    /// visible strips intersecting registered viewports.
    pub(crate) fn produce_row_col_format_viewport_patches(
        &mut self,
        sheet_id: &SheetId,
        rows: &[u32],
        cols: &[u32],
    ) -> Vec<u8> {
        let mut positions: FxHashSet<(u32, u32)> = FxHashSet::default();

        for (_viewport_id, bounds) in self.viewport.viewports_for_sheet(sheet_id) {
            for &row in rows {
                if row < bounds.start_row || row > bounds.end_row {
                    continue;
                }
                for col in bounds.start_col..=bounds.end_col {
                    positions.insert((row, col));
                }
            }

            for &col in cols {
                if col < bounds.start_col || col > bounds.end_col {
                    continue;
                }
                for row in bounds.start_row..=bounds.end_row {
                    positions.insert((row, col));
                }
            }
        }

        if positions.is_empty() {
            return compute_wire::mutation::serialize_multi_viewport_patches(&[]);
        }

        let mut positions: Vec<(u32, u32)> = positions.into_iter().collect();
        positions.sort_unstable();

        let sheet_id_str = sheet_id.to_uuid_string();

        // Pass 1: collect value + effective format without holding the
        // mutable palette borrow needed for interning.
        let mut cell_data: Vec<(String, u32, u32, CellValue, CellFormat)> =
            Vec::with_capacity(positions.len());

        for (row, col) in positions {
            let pos = SheetPos::new(row, col);
            let resolved_cell_id = self.mirror.resolve_cell_id(sheet_id, pos);
            let value = resolved_cell_id
                .as_ref()
                .and_then(|cell_id| self.stores.compute.get_cell_value(&self.mirror, cell_id))
                .cloned()
                .unwrap_or_else(|| {
                    self.mirror
                        .get_cell_value_at(sheet_id, pos)
                        .cloned()
                        .unwrap_or(CellValue::Null)
                });
            let cell_id_str = resolved_cell_id
                .as_ref()
                .map(|cell_id| cell_id.to_uuid_string())
                .unwrap_or_default();
            let cell_hex = resolved_cell_id
                .as_ref()
                .map(|cell_id| id_to_hex(cell_id.as_u128()))
                .unwrap_or_default();
            let table_fmt =
                services::tables::resolve_table_format_at_cell(&self.mirror, sheet_id, row, col);
            let effective = properties::get_effective_format(
                &self.stores.storage,
                sheet_id,
                &cell_hex,
                row,
                col,
                table_fmt.as_ref(),
                self.stores.grid_indexes.get(sheet_id),
                self.mirror.get_sheet(sheet_id),
            );

            cell_data.push((cell_id_str, row, col, value, effective));
        }

        // Pass 2: intern effective formats into the sheet palette.
        let mut palettes = self.viewport.format_palettes_mut();
        let palette = palettes.entry(*sheet_id).or_default();
        let palette_len_before = palette.len() as u16;
        let theme_palette = &self.settings.theme_palette;

        let mut changed_cells: Vec<snapshot_types::CellChange> =
            Vec::with_capacity(cell_data.len());
        for (cell_id, row, col, value, mut effective) in cell_data {
            domain_types::theme_color::resolve_theme_refs(&mut effective, theme_palette);
            let format_idx = palette.intern(&effective).unwrap_or(0);
            changed_cells.push(snapshot_types::CellChange {
                cell_id,
                sheet_id: sheet_id_str.clone(),
                position: Some(snapshot_types::CellPosition { row, col }),
                value,
                display_text: None,
                format_idx: Some(format_idx),
                extra_flags: 0,
                old_value: None,
            });
        }

        let delta_formats = palette.formats_since(palette_len_before);
        let palette_bytes = compute_wire::palette_binary::serialize_palette_binary(
            delta_formats,
            palette_len_before,
        );
        drop(palettes);

        let mut recalc = RecalcResult::empty();
        recalc.changed_cells = changed_cells;

        self.produce_format_viewport_patches(
            &mut recalc,
            sheet_id,
            palette_len_before,
            &palette_bytes,
        )
    }

    /// Produce multi-viewport patches for a recalc result (possibly multi-sheet).
    ///
    /// Refreshes CF caches, enriches display text, then iterates all registered
    /// viewports across all affected sheets to produce a merged binary payload.
    fn produce_viewport_patches_for_recalc(&mut self, recalc: &mut RecalcResult) -> Vec<u8> {
        // Refresh CF caches and collect cells whose CF result changed as a
        // side-effect of sibling cells changing (e.g. Duplicate-Values,
        // Top-N). These cells need viewport patches even though their values
        // didn't change — otherwise the old CF color stays in the TS buffer.
        let cf_only_changes = self.refresh_cf_caches_after_recalc(recalc);

        // Synthesize CellChange entries for CF-only-changed cells and append
        // them to recalc.changed_cells so they flow through the standard
        // enrichment + serialization pipeline.
        for (sheet_id, positions) in &cf_only_changes {
            let sheet_id_str = sheet_id.to_uuid_string();
            for &(row, col) in positions {
                let pos = SheetPos::new(row, col);
                let value = self
                    .mirror
                    .get_cell_value_at(sheet_id, pos)
                    .cloned()
                    .unwrap_or(CellValue::Null);
                let cell_id_str = self
                    .stores
                    .grid_indexes
                    .get(sheet_id)
                    .and_then(|g| g.cell_id_at(row, col))
                    .map(|cid| cid.to_uuid_string())
                    .unwrap_or_default();
                recalc.changed_cells.push(snapshot_types::CellChange {
                    cell_id: cell_id_str,
                    sheet_id: sheet_id_str.clone(),
                    position: Some(snapshot_types::CellPosition { row, col }),
                    value,
                    display_text: None, // filled by enrich_display_text below
                    format_idx: None,   // filled by format enrichment in patch loop
                    extra_flags: 0,
                    old_value: None,
                });
            }
        }

        self.enrich_display_text(recalc);

        // Collect unique sheet IDs from changed cells + projections
        let mut sheet_ids: Vec<SheetId> = Vec::new();
        for change in &recalc.changed_cells {
            if let Ok(sid) = SheetId::from_uuid_str(&change.sheet_id)
                && !sheet_ids.contains(&sid)
            {
                sheet_ids.push(sid);
            }
        }
        for proj in &recalc.projection_changes {
            if let Ok(sid) = SheetId::from_uuid_str(&proj.sheet_id)
                && !sheet_ids.contains(&sid)
            {
                sheet_ids.push(sid);
            }
        }

        if sheet_ids.is_empty() {
            return compute_wire::mutation::serialize_multi_viewport_patches(&[]);
        }

        if sheet_ids.len() == 1 {
            return self.produce_viewport_patches(recalc, &sheet_ids[0], 0);
        }

        // Multi-sheet recalc does not delegate to `produce_viewport_patches`,
        // so it must run the same metadata enrichment before serialization.
        self.enrich_metadata_flags(recalc);

        // Enrich format_idx for all changed cells across all sheets.
        let theme_palette = &self.settings.theme_palette;
        let mut per_sheet_palette_params: FxHashMap<SheetId, (u16, Vec<u8>)> = FxHashMap::default();
        for sid in &sheet_ids {
            let mut palettes = self.viewport.format_palettes_mut();
            let palette = palettes.entry(*sid).or_default();
            let palette_len_before = palette.len() as u16;
            let sid_str = sid.to_uuid_string();
            for change in &mut recalc.changed_cells {
                if change.format_idx.is_some() {
                    continue;
                }
                if change.sheet_id != sid_str {
                    continue;
                }
                let Some(pos) = change.position.clone() else {
                    continue;
                };
                let cell_hex = match CellId::from_uuid_str(&change.cell_id) {
                    Ok(cid) => id_to_hex(cid.as_u128()),
                    Err(_) => continue,
                };
                let table_fmt = services::tables::resolve_table_format_at_cell(
                    &self.mirror,
                    sid,
                    pos.row,
                    pos.col,
                );
                let mut effective = properties::get_effective_format(
                    &self.stores.storage,
                    sid,
                    &cell_hex,
                    pos.row,
                    pos.col,
                    table_fmt.as_ref(),
                    self.stores.grid_indexes.get(sid),
                    self.mirror.get_sheet(sid),
                );
                domain_types::theme_color::resolve_theme_refs(&mut effective, theme_palette);
                let idx = palette.intern(&effective).unwrap_or(0);
                change.format_idx = Some(idx);
            }
            let delta_formats = palette.formats_since(palette_len_before);
            let palette_bytes = compute_wire::palette_binary::serialize_palette_binary(
                delta_formats,
                palette_len_before,
            );
            per_sheet_palette_params.insert(*sid, (palette_len_before, palette_bytes));
        }

        let mut all_patches: Vec<(String, Vec<u8>)> = Vec::new();
        for sheet_id in &sheet_ids {
            let sheet_id_str = sheet_id.to_uuid_string();
            let cf_colors = self.build_cf_color_overrides(sheet_id);
            let palette_param =
                per_sheet_palette_params
                    .get(sheet_id)
                    .and_then(|(start, bytes)| {
                        if bytes.is_empty() {
                            None
                        } else {
                            Some(PaletteSnapshot {
                                start_index: *start,
                                palette_bytes: bytes.as_slice(),
                            })
                        }
                    });
            for (viewport_id, bounds) in self.viewport.viewports_for_sheet(sheet_id) {
                let patch = compute_wire::mutation::serialize_mutation_result_for_viewport(
                    recalc,
                    &sheet_id_str,
                    0,
                    bounds,
                    palette_param,
                    cf_colors.as_ref(),
                );
                all_patches.push((viewport_id.to_string(), patch));
            }
        }
        compute_wire::mutation::serialize_multi_viewport_patches(&all_patches)
    }

    /// Pull viewport patches for the stashed pending recalc result.
    pub fn flush_viewport_patches(&mut self) -> Vec<u8> {
        let format_patches = self.mutation.pending_format_patches.take();
        let value_patches = match self.mutation.pending_recalc.take() {
            Some(mut recalc) => self.produce_viewport_patches_for_recalc(&mut recalc),
            None => compute_wire::mutation::serialize_multi_viewport_patches(&[]),
        };

        match format_patches {
            Some(format_patches) => compute_wire::mutation::concat_multi_viewport_patches(&[
                format_patches,
                value_patches,
            ]),
            None => value_patches,
        }
    }

    /// Pull format-specific viewport patches (with palette delta).
    pub fn flush_format_viewport_patches(&mut self) -> Vec<u8> {
        self.mutation
            .pending_format_patches
            .take()
            .unwrap_or_default()
    }

    /// Build viewport patches (with palette delta) for a set of format-changed cells.
    ///
    /// 1. Records the palette length before interning.
    /// 2. For each affected cell, reads the current value from the mirror (or compute
    ///    core for formula cells), resolves the effective format, and interns it into
    ///    the palette to get a `format_idx`.
    /// 3. Builds a synthetic `RecalcResult` with `CellChange` entries.
    /// 4. Serializes the palette delta and produces viewport patches via
    ///    `produce_format_viewport_patches`.
    pub(crate) fn produce_format_change_patches(
        &mut self,
        sheet_id: &SheetId,
        affected_cells: &[(u128, u32, u32)],
    ) -> Vec<u8> {
        let sheet_id_str = sheet_id.to_uuid_string();

        // Pass 1: Collect (cell_id_u128, row, col, value, effective_format) from mirror.
        // We need to release the mirror borrow before calling get_or_create_palette (&mut self).
        let mut cell_data: Vec<(u128, u32, u32, CellValue, CellFormat)> =
            Vec::with_capacity(affected_cells.len());

        {
            let mirror = &self.mirror;
            for &(cell_id_raw, row, col) in affected_cells {
                let cell_id = CellId::from_raw(cell_id_raw);

                // Read value: prefer compute-core result (formula cells), fall back to mirror.
                let value = self
                    .stores
                    .compute
                    .get_cell_value(&self.mirror, &cell_id)
                    .cloned()
                    .unwrap_or_else(|| {
                        mirror
                            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
                            .cloned()
                            .unwrap_or(CellValue::Null)
                    });

                let cell_hex = id_to_hex(cell_id_raw);
                let table_fmt = services::tables::resolve_table_format_at_cell(
                    &self.mirror,
                    sheet_id,
                    row,
                    col,
                );
                let effective = properties::get_effective_format(
                    &self.stores.storage,
                    sheet_id,
                    &cell_hex,
                    row,
                    col,
                    table_fmt.as_ref(),
                    self.stores.grid_indexes.get(sheet_id),
                    mirror.get_sheet(sheet_id),
                );

                cell_data.push((cell_id_raw, row, col, value, effective));
            }
        }

        // Pass 2: Intern formats into the palette (interior-mutable borrow).
        let mut palettes = self.viewport.format_palettes_mut();
        let palette = palettes.entry(*sheet_id).or_default();
        let palette_len_before = palette.len() as u16;

        let mut changed_cells: Vec<snapshot_types::CellChange> =
            Vec::with_capacity(cell_data.len());
        let theme_palette = &self.settings.theme_palette;
        for (cell_id_raw, row, col, value, mut effective) in cell_data {
            domain_types::theme_color::resolve_theme_refs(&mut effective, theme_palette);
            let format_idx = palette.intern(&effective).unwrap_or(0);
            changed_cells.push(snapshot_types::CellChange {
                cell_id: CellId::from_raw(cell_id_raw).to_uuid_string(),
                sheet_id: sheet_id_str.to_string(),
                position: Some(snapshot_types::CellPosition { row, col }),
                value,
                display_text: None,
                format_idx: Some(format_idx),
                extra_flags: 0,
                old_value: None,
            });
        }

        // Pass 3: Build palette delta binary.
        let delta_formats = palette.formats_since(palette_len_before);
        let palette_bytes = compute_wire::palette_binary::serialize_palette_binary(
            delta_formats,
            palette_len_before,
        );
        drop(palettes);

        // Pass 4: Build RecalcResult and produce viewport patches.
        let mut recalc = RecalcResult::empty();
        recalc.changed_cells = changed_cells;

        self.produce_format_viewport_patches(
            &mut recalc,
            sheet_id,
            palette_len_before,
            &palette_bytes,
        )
    }

    /// Produce viewport patches for remap-style partial cell shifts.
    ///
    /// Row/column structure changes carry `StructureChangeResult` and are
    /// followed by a bridge-level forced viewport refresh, so they should not
    /// call this. Partial cell shifts do not carry that structural signal; the
    /// recalc pipeline only emits *value* changes, so moved-but-unchanged cells
    /// still need explicit patches.
    pub(crate) fn produce_structural_patches(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<crate::snapshot::CellChange> {
        let sheet_id_str = sheet_id.to_uuid_string();
        let mut patches = Vec::new();

        for (_viewport_id, bounds) in self.viewport.viewports_for_sheet(sheet_id) {
            patches.reserve(
                ((bounds.end_row - bounds.start_row + 1) * (bounds.end_col - bounds.start_col + 1))
                    as usize,
            );

            for row in bounds.start_row..=bounds.end_row {
                for col in bounds.start_col..=bounds.end_col {
                    let pos = SheetPos::new(row, col);
                    let value = self
                        .mirror
                        .get_cell_value_at(sheet_id, pos)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    let cell_id = self
                        .mirror
                        .resolve_cell_id(sheet_id, pos)
                        .map(|id| id.to_uuid_string())
                        .unwrap_or_default();

                    patches.push(crate::snapshot::CellChange {
                        cell_id,
                        sheet_id: sheet_id_str.clone(),
                        position: Some(crate::snapshot::CellPosition { row, col }),
                        value,
                        display_text: None, // enriched by prepare_recalc_for_flush
                        format_idx: None,
                        extra_flags: 0,
                        old_value: None,
                    });
                }
            }
        }

        patches
    }

    /// Build format viewport patches from observer property changes.
    ///
    /// Merges the former `mod.rs` wrapper and `functions::build_format_patches_from_observer`
    /// free function into one self-contained method. For each changed property cell,
    /// resolves (row, col) from grid_indexes, collects effective formats, interns them
    /// into palettes, enriches display text and metadata flags, and serializes viewport
    /// patches.
    pub(crate) fn produce_observer_format_patches(
        &mut self,
        doc_changes: &compute_document::observe::DocumentChanges,
    ) -> Vec<u8> {
        // ── Borrow splitting ────────────────────────────────────────────
        // We must take shared refs to stores/mirror/settings BEFORE taking
        // &mut self.viewport, because the format closure captures the first
        // three while the body mutates the viewport.
        let mirror = &self.mirror;
        let stores = &self.stores;
        let settings = &self.settings;

        // Build the format_value closure (previously in mod.rs wrapper).
        let format_fn = |value: &CellValue, sheet_id: &SheetId, row: u32, col: u32| -> String {
            let cell_id_hex = mirror
                .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                .map(|cid| id_to_hex(cid.as_u128()))
                .unwrap_or_default();
            let table_fmt =
                services::tables::resolve_table_format_at_cell(mirror, sheet_id, row, col);
            let mut effective = properties::get_effective_format(
                &stores.storage,
                sheet_id,
                &cell_id_hex,
                row,
                col,
                table_fmt.as_ref(),
                stores.grid_indexes.get(sheet_id),
                mirror.get_sheet(sheet_id),
            );
            domain_types::theme_color::resolve_theme_refs(&mut effective, &settings.theme_palette);
            let format_code = effective.number_format.as_deref().unwrap_or("General");
            compute_formats::format_value(value, format_code, &settings.locale).text
        };

        // ── Pass 0: Group affected cells by sheet ──────────────────────
        //
        // Undoing a format on a previously-empty cell removes both the
        // property payload and the sparse gridIndex cell binding. At this
        // point apply_all_observer_changes has already applied the gridIndex
        // removal, so cell_id -> (row, col) can be gone. The observer's
        // gridIndex change still carries row/col identity hexes; use them as
        // the authoritative fallback for the matching property change.
        let mut grid_position_fallbacks: FxHashMap<(SheetId, CellId), (u32, u32)> =
            FxHashMap::default();
        for change in &doc_changes.grid_index {
            let Some(row) = services::mutation::resolve_hex_id_to_position(
                stores,
                &change.sheet_id,
                &change.row_hex,
                true,
            ) else {
                continue;
            };
            let Some(col) = services::mutation::resolve_hex_id_to_position(
                stores,
                &change.sheet_id,
                &change.col_hex,
                false,
            ) else {
                continue;
            };
            grid_position_fallbacks
                .entry((change.sheet_id, change.cell_id))
                .or_insert((row, col));
        }

        let mut by_sheet: FxHashMap<SheetId, Vec<(u128, u32, u32)>> = FxHashMap::default();

        for pch in &doc_changes.properties {
            let position = stores
                .grid_indexes
                .get(&pch.sheet_id)
                .and_then(|grid| grid.cell_position(&pch.cell_id))
                .or_else(|| {
                    grid_position_fallbacks
                        .get(&(pch.sheet_id, pch.cell_id))
                        .copied()
                });

            if let Some((row, col)) = position {
                by_sheet
                    .entry(pch.sheet_id)
                    .or_default()
                    .push((pch.cell_id.as_u128(), row, col));
            }
        }

        if by_sheet.is_empty() {
            return vec![];
        }

        let viewport = &self.viewport;
        let mut all_patches: Vec<(String, Vec<u8>)> = Vec::new();

        for (sheet_id, affected_cells) in &by_sheet {
            let sheet_id_str = sheet_id.to_uuid_string();

            // Pass 1: Collect cell data
            let mut cell_data: Vec<(u128, u32, u32, CellValue, CellFormat)> =
                Vec::with_capacity(affected_cells.len());
            for &(cell_id_raw, row, col) in affected_cells {
                let cell_id = CellId::from_raw(cell_id_raw);
                let value = stores
                    .compute
                    .get_cell_value(mirror, &cell_id)
                    .cloned()
                    .unwrap_or_else(|| {
                        mirror
                            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
                            .cloned()
                            .unwrap_or(CellValue::Null)
                    });
                let cell_hex = id_to_hex(cell_id_raw);
                let table_fmt =
                    services::tables::resolve_table_format_at_cell(mirror, sheet_id, row, col);
                let effective = properties::get_effective_format(
                    &stores.storage,
                    sheet_id,
                    &cell_hex,
                    row,
                    col,
                    table_fmt.as_ref(),
                    stores.grid_indexes.get(sheet_id),
                    mirror.get_sheet(sheet_id),
                );
                cell_data.push((cell_id_raw, row, col, value, effective));
            }

            // Pass 2: Intern formats into palette (interior-mutable borrow).
            let mut palettes = viewport.format_palettes_mut();
            let palette = palettes.entry(*sheet_id).or_default();
            let palette_len_before = palette.len() as u16;

            let mut changed_cells: Vec<snapshot_types::CellChange> =
                Vec::with_capacity(cell_data.len());
            for (cell_id_raw, row, col, value, mut effective) in cell_data {
                domain_types::theme_color::resolve_theme_refs(
                    &mut effective,
                    &settings.theme_palette,
                );
                let format_idx = palette.intern(&effective).unwrap_or(0);
                changed_cells.push(snapshot_types::CellChange {
                    cell_id: CellId::from_raw(cell_id_raw).to_uuid_string(),
                    sheet_id: sheet_id_str.clone(),
                    position: Some(snapshot_types::CellPosition { row, col }),
                    value,
                    display_text: None,
                    format_idx: Some(format_idx),
                    extra_flags: 0,
                    old_value: None,
                });
            }

            // Pass 3: Build palette delta binary
            let delta_formats = palette.formats_since(palette_len_before);
            let palette_bytes = compute_wire::palette_binary::serialize_palette_binary(
                delta_formats,
                palette_len_before,
            );
            drop(palettes);

            // Pass 4: Enrich display text + metadata flags
            let mut recalc = crate::snapshot::RecalcResult::empty();
            recalc.changed_cells = changed_cells;
            crate::storage::engine::services::mutation_handlers::enrich_display_text(
                stores,
                mirror,
                settings,
                &mut recalc,
                &format_fn,
            );
            crate::storage::engine::services::mutation_handlers::enrich_metadata_flags(
                stores,
                mirror,
                &mut recalc,
            );

            let cf_colors = super::functions::build_cf_color_overrides(stores, sheet_id);
            let palette_param = if palette_bytes.is_empty() {
                None
            } else {
                Some(PaletteSnapshot {
                    start_index: palette_len_before,
                    palette_bytes: palette_bytes.as_slice(),
                })
            };

            let regs = viewport.registered_viewports();
            for (viewport_id, reg) in regs.iter() {
                if reg.sheet_id != *sheet_id {
                    continue;
                }
                let patch = compute_wire::mutation::serialize_mutation_result_for_viewport(
                    &recalc,
                    &sheet_id_str,
                    0,
                    reg.bounds,
                    palette_param,
                    cf_colors.as_ref(),
                );
                all_patches.push((viewport_id.clone(), patch));
            }
        }

        compute_wire::mutation::serialize_multi_viewport_patches(&all_patches)
    }
}
