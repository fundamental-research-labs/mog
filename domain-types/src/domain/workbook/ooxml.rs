//! OOXML conversion implementations for workbook domain types.

use super::{
    CalcMode, CalculationProperties, FileSharing, FileVersion, ObjectDisplayMode, RefMode,
    UpdateLinks, WorkbookProperties, WorkbookProtection, WorkbookView, WorkbookViewVisibility,
};

// ============================================================================
// From/Into: ooxml_types → domain_types
// ============================================================================

impl From<ooxml_types::workbook::CalcMode> for CalcMode {
    fn from(v: ooxml_types::workbook::CalcMode) -> Self {
        match v {
            ooxml_types::workbook::CalcMode::Auto => Self::Auto,
            ooxml_types::workbook::CalcMode::AutoNoTable => Self::AutoNoTable,
            ooxml_types::workbook::CalcMode::Manual => Self::Manual,
        }
    }
}

impl From<ooxml_types::workbook::RefMode> for RefMode {
    fn from(v: ooxml_types::workbook::RefMode) -> Self {
        match v {
            ooxml_types::workbook::RefMode::A1 => Self::A1,
            ooxml_types::workbook::RefMode::R1C1 => Self::R1C1,
        }
    }
}

impl From<ooxml_types::workbook::Visibility> for WorkbookViewVisibility {
    fn from(v: ooxml_types::workbook::Visibility) -> Self {
        match v {
            ooxml_types::workbook::Visibility::Visible => Self::Visible,
            ooxml_types::workbook::Visibility::Hidden => Self::Hidden,
            ooxml_types::workbook::Visibility::VeryHidden => Self::VeryHidden,
        }
    }
}

impl From<ooxml_types::workbook::ObjectDisplayMode> for ObjectDisplayMode {
    fn from(v: ooxml_types::workbook::ObjectDisplayMode) -> Self {
        match v {
            ooxml_types::workbook::ObjectDisplayMode::All => Self::All,
            ooxml_types::workbook::ObjectDisplayMode::Placeholders => Self::Placeholders,
            ooxml_types::workbook::ObjectDisplayMode::None => Self::None,
        }
    }
}

impl From<ooxml_types::workbook::UpdateLinks> for UpdateLinks {
    fn from(v: ooxml_types::workbook::UpdateLinks) -> Self {
        match v {
            ooxml_types::workbook::UpdateLinks::UserSet => Self::UserSet,
            ooxml_types::workbook::UpdateLinks::Never => Self::Never,
            ooxml_types::workbook::UpdateLinks::Always => Self::Always,
        }
    }
}

impl From<ooxml_types::workbook::CalcPr> for CalculationProperties {
    fn from(v: ooxml_types::workbook::CalcPr) -> Self {
        Self {
            iterate: v.iterate,
            iterate_count: v.iterate_count,
            iterate_delta: v.iterate_delta,
            calc_mode: v.calc_mode.into(),
            full_calc_on_load: v.full_calc_on_load,
            ref_mode: v.ref_mode.into(),
            full_precision: v.full_precision,
            calc_completed: v.calc_completed,
            calc_on_save: v.calc_on_save,
            concurrent_calc: v.concurrent_calc,
            concurrent_manual_count: v.concurrent_manual_count,
            calc_id: v.calc_id,
            force_full_calc: v.force_full_calc,
            has_explicit_iterate_count: v.has_explicit_iterate_count,
            has_explicit_iterate_delta: v.has_explicit_iterate_delta,
        }
    }
}

impl From<ooxml_types::protection::WorkbookProtection> for WorkbookProtection {
    fn from(v: ooxml_types::protection::WorkbookProtection) -> Self {
        Self {
            lock_structure: v.lock_structure,
            lock_windows: v.lock_windows,
            lock_revision: v.lock_revision,
            workbook_algorithm_name: v.workbook_algorithm_name,
            workbook_hash_value: v.workbook_hash_value,
            workbook_salt_value: v.workbook_salt_value,
            workbook_spin_count: v.workbook_spin_count,
            revisions_algorithm_name: v.revisions_algorithm_name,
            revisions_hash_value: v.revisions_hash_value,
            revisions_salt_value: v.revisions_salt_value,
            revisions_spin_count: v.revisions_spin_count,
            workbook_password: v.workbook_password,
            workbook_password_character_set: v.workbook_password_character_set,
            revisions_password: v.revisions_password,
            revisions_password_character_set: v.revisions_password_character_set,
        }
    }
}

impl From<ooxml_types::workbook::BookView> for WorkbookView {
    fn from(v: ooxml_types::workbook::BookView) -> Self {
        Self {
            active_tab: v.active_tab,
            first_sheet: v.first_sheet,
            visibility: v.visibility.into(),
            minimized: v.minimized,
            show_horizontal_scroll: v.show_horizontal_scroll,
            show_vertical_scroll: v.show_vertical_scroll,
            show_sheet_tabs: v.show_sheet_tabs,
            auto_filter_date_grouping: v.auto_filter_date_grouping,
            x_window: v.x_window,
            y_window: v.y_window,
            window_width: v.window_width,
            window_height: v.window_height,
            tab_ratio: v.tab_ratio,
            uid: v.xr_uid,
            ext_lst_raw: v.ext_lst.and_then(|ext| ext.raw_xml),
        }
    }
}

impl From<ooxml_types::workbook::WorkbookPr> for WorkbookProperties {
    fn from(v: ooxml_types::workbook::WorkbookPr) -> Self {
        Self {
            date1904: v.date1904,
            show_objects: v.show_objects.into(),
            show_border_unselected_tables: v.show_border_unselected_tables,
            filter_privacy: v.filter_privacy,
            prompted_solutions: v.prompted_solutions,
            show_ink_annotation: v.show_ink_annotation,
            backup_file: v.backup_file,
            save_external_link_values: v.save_external_link_values,
            update_links: v.update_links.into(),
            code_name: v.code_name,
            hide_pivot_field_list: v.hide_pivot_field_list,
            show_pivot_chart_filter: v.show_pivot_chart_filter,
            allow_refresh_query: v.allow_refresh_query,
            publish_items: v.publish_items,
            check_compatibility: v.check_compatibility,
            auto_compress_pictures: v.auto_compress_pictures,
            refresh_all_connections: v.refresh_all_connections,
            default_theme_version: v.default_theme_version,
        }
    }
}

impl From<ooxml_types::workbook::FileVersion> for FileVersion {
    fn from(v: ooxml_types::workbook::FileVersion) -> Self {
        Self {
            app_name: v.app_name,
            last_edited: v.last_edited,
            lowest_edited: v.lowest_edited,
            rup_build: v.rup_build,
            code_name: v.code_name,
        }
    }
}

impl From<ooxml_types::workbook::FileSharing> for FileSharing {
    fn from(v: ooxml_types::workbook::FileSharing) -> Self {
        Self {
            read_only_recommended: v.read_only_recommended,
            user_name: v.user_name,
            reservation_password: v.reservation_password,
            algorithm_name: v.algorithm_name,
            hash_value: v.hash_value,
            salt_value: v.salt_value,
            spin_count: v.spin_count,
        }
    }
}

// ============================================================================
// From/Into: domain_types → ooxml_types (export path)
// ============================================================================

impl From<CalcMode> for ooxml_types::workbook::CalcMode {
    fn from(v: CalcMode) -> Self {
        match v {
            CalcMode::Auto => Self::Auto,
            CalcMode::AutoNoTable => Self::AutoNoTable,
            CalcMode::Manual => Self::Manual,
        }
    }
}

impl From<RefMode> for ooxml_types::workbook::RefMode {
    fn from(v: RefMode) -> Self {
        match v {
            RefMode::A1 => Self::A1,
            RefMode::R1C1 => Self::R1C1,
        }
    }
}

impl From<WorkbookViewVisibility> for ooxml_types::workbook::Visibility {
    fn from(v: WorkbookViewVisibility) -> Self {
        match v {
            WorkbookViewVisibility::Visible => Self::Visible,
            WorkbookViewVisibility::Hidden => Self::Hidden,
            WorkbookViewVisibility::VeryHidden => Self::VeryHidden,
        }
    }
}

impl From<ObjectDisplayMode> for ooxml_types::workbook::ObjectDisplayMode {
    fn from(v: ObjectDisplayMode) -> Self {
        match v {
            ObjectDisplayMode::All => Self::All,
            ObjectDisplayMode::Placeholders => Self::Placeholders,
            ObjectDisplayMode::None => Self::None,
        }
    }
}

impl From<UpdateLinks> for ooxml_types::workbook::UpdateLinks {
    fn from(v: UpdateLinks) -> Self {
        match v {
            UpdateLinks::UserSet => Self::UserSet,
            UpdateLinks::Never => Self::Never,
            UpdateLinks::Always => Self::Always,
        }
    }
}

impl From<CalculationProperties> for ooxml_types::workbook::CalcPr {
    fn from(v: CalculationProperties) -> Self {
        Self {
            calc_id: v.calc_id,
            calc_mode: v.calc_mode.into(),
            full_calc_on_load: v.full_calc_on_load,
            ref_mode: v.ref_mode.into(),
            iterate: v.iterate,
            iterate_count: v.iterate_count,
            iterate_delta: v.iterate_delta,
            full_precision: v.full_precision,
            calc_completed: v.calc_completed,
            calc_on_save: v.calc_on_save,
            concurrent_calc: v.concurrent_calc,
            concurrent_manual_count: v.concurrent_manual_count,
            force_full_calc: v.force_full_calc,
            has_explicit_iterate_count: v.has_explicit_iterate_count,
            has_explicit_iterate_delta: v.has_explicit_iterate_delta,
        }
    }
}

impl From<WorkbookProtection> for ooxml_types::protection::WorkbookProtection {
    fn from(v: WorkbookProtection) -> Self {
        Self {
            lock_structure: v.lock_structure,
            lock_windows: v.lock_windows,
            lock_revision: v.lock_revision,
            workbook_algorithm_name: v.workbook_algorithm_name,
            workbook_hash_value: v.workbook_hash_value,
            workbook_salt_value: v.workbook_salt_value,
            workbook_spin_count: v.workbook_spin_count,
            revisions_algorithm_name: v.revisions_algorithm_name,
            revisions_hash_value: v.revisions_hash_value,
            revisions_salt_value: v.revisions_salt_value,
            revisions_spin_count: v.revisions_spin_count,
            workbook_password: v.workbook_password,
            workbook_password_character_set: v.workbook_password_character_set,
            revisions_password: v.revisions_password,
            revisions_password_character_set: v.revisions_password_character_set,
        }
    }
}

impl From<WorkbookView> for ooxml_types::workbook::BookView {
    fn from(v: WorkbookView) -> Self {
        Self {
            visibility: v.visibility.into(),
            minimized: v.minimized,
            show_horizontal_scroll: v.show_horizontal_scroll,
            show_vertical_scroll: v.show_vertical_scroll,
            show_sheet_tabs: v.show_sheet_tabs,
            x_window: v.x_window,
            y_window: v.y_window,
            window_width: v.window_width,
            window_height: v.window_height,
            tab_ratio: v.tab_ratio,
            first_sheet: v.first_sheet,
            active_tab: v.active_tab,
            auto_filter_date_grouping: v.auto_filter_date_grouping,
            xr_uid: v.uid,
            ext_lst: v.ext_lst_raw.map(|raw_xml| ooxml_types::ExtensionList {
                raw_xml: Some(raw_xml),
            }),
        }
    }
}

impl From<WorkbookProperties> for ooxml_types::workbook::WorkbookPr {
    fn from(v: WorkbookProperties) -> Self {
        Self {
            date1904: v.date1904,
            show_objects: v.show_objects.into(),
            show_border_unselected_tables: v.show_border_unselected_tables,
            filter_privacy: v.filter_privacy,
            prompted_solutions: v.prompted_solutions,
            show_ink_annotation: v.show_ink_annotation,
            backup_file: v.backup_file,
            save_external_link_values: v.save_external_link_values,
            update_links: v.update_links.into(),
            code_name: v.code_name,
            hide_pivot_field_list: v.hide_pivot_field_list,
            show_pivot_chart_filter: v.show_pivot_chart_filter,
            allow_refresh_query: v.allow_refresh_query,
            publish_items: v.publish_items,
            check_compatibility: v.check_compatibility,
            auto_compress_pictures: v.auto_compress_pictures,
            refresh_all_connections: v.refresh_all_connections,
            default_theme_version: v.default_theme_version,
        }
    }
}

impl From<FileVersion> for ooxml_types::workbook::FileVersion {
    fn from(v: FileVersion) -> Self {
        Self {
            app_name: v.app_name,
            last_edited: v.last_edited,
            lowest_edited: v.lowest_edited,
            rup_build: v.rup_build,
            code_name: v.code_name,
        }
    }
}

impl From<FileSharing> for ooxml_types::workbook::FileSharing {
    fn from(v: FileSharing) -> Self {
        Self {
            read_only_recommended: v.read_only_recommended,
            user_name: v.user_name,
            algorithm_name: v.algorithm_name,
            hash_value: v.hash_value,
            salt_value: v.salt_value,
            spin_count: v.spin_count,
            reservation_password: v.reservation_password,
        }
    }
}
