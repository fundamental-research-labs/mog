use super::*;
use domain_types::domain::slicer::{
    XlsxSlicerImportContext, xlsx_import_to_stored_slicer, xlsx_import_to_stored_timeline,
};

fn add_controls(
    engine: &mut ComputeEngine,
    sheet: SheetId,
    pivot: &domain_types::domain::pivot::PivotTableConfig,
    name: &str,
    cache: &str,
    external: Option<&domain_types::domain::pivot::PivotTableConfig>,
) {
    let slicer = xlsx_import_to_stored_slicer(
        &ooxml_types::slicers::SlicerDef {
            name: name.into(),
            cache: cache.into(),
            ..Default::default()
        },
        Some(&ooxml_types::slicers::SlicerCacheDef {
            name: cache.into(),
            source_name: "Region".into(),
            pivot_tables: vec![ooxml_types::slicers::SlicerPivotTableRef {
                tab_id: 7,
                name: pivot.name.clone(),
            }],
            tabular_data: Some(ooxml_types::slicers::SlicerTabularData {
                pivot_cache_id: pivot.cache_id.unwrap(),
                ..Default::default()
            }),
            ..Default::default()
        }),
        None,
        XlsxSlicerImportContext {
            sheet_id: &sheet.to_uuid_string(),
            source_table_id: None,
            source_table_column_id: None,
            table_filter_selected_values: None,
        },
    );
    engine
        .stores
        .storage
        .metadata
        .slicers
        .insert(slicer.id.clone(), slicer);
    let references = std::iter::once(pivot)
        .chain(external)
        .map(|pivot| ooxml_types::timelines::TimelinePivotTableRef {
            tab_id: 7,
            name: pivot.name.clone(),
        })
        .collect();
    let timeline = xlsx_import_to_stored_timeline(
        &ooxml_types::timelines::TimelineDef {
            name: format!("Timeline{name}"),
            cache: format!("Timeline{cache}"),
            ..Default::default()
        },
        Some(&ooxml_types::timelines::TimelineCacheDef {
            name: format!("Timeline{cache}"),
            source_name: "Region".into(),
            pivot_cache_id: pivot.cache_id,
            pivot_tables: references,
            ..Default::default()
        }),
        None,
        &sheet.to_uuid_string(),
    );
    engine
        .stores
        .storage
        .metadata
        .timelines
        .insert(timeline.id.clone(), timeline);
}

#[test]
fn repeated_copies_keep_names_cache_ownership_and_numeric_sheet_bindings_unique() {
    let sid = sheet_id();
    let (mut engine, _) = ComputeEngine::from_snapshot(pivot_snapshot(sid)).unwrap();
    create_region_sales_pivot(&mut engine, sid, "RepeatedPivot");
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let source = engine.storage().sheet_order()[0];
    let original = engine.pivot_get_all(&source).pop().unwrap();
    engine
        .stores
        .storage
        .sheet_metadata
        .get_mut(&source)
        .unwrap()
        .original_sheet_id = Some(u32::MAX);
    // Distinct names with a common 220-character prefix must remain distinct
    // after truncation, while two controls sharing one cache keep that sharing.
    let prefix = "Region".repeat(37);
    for (suffix, cache_suffix) in [("A", "A"), ("B", "B"), ("C", "A")] {
        add_controls(
            &mut engine,
            source,
            &original,
            &format!("{prefix}{suffix}"),
            &format!("{prefix}Cache{cache_suffix}"),
            None,
        );
    }
    let (first, _) = engine.copy_sheet(&source, "First").unwrap();
    let first = SheetId::from_uuid_str(&first).unwrap();
    let (second, _) = engine.copy_sheet(&source, "Second").unwrap();
    let second = SheetId::from_uuid_str(&second).unwrap();
    let first_pivot = engine.pivot_get_all(&first).pop().unwrap();
    let second_pivot = engine.pivot_get_all(&second).pop().unwrap();
    assert_ne!(first_pivot.name, second_pivot.name);
    assert_ne!(first_pivot.cache_id, second_pivot.cache_id);
    for id in [source, first, second] {
        let slicers = engine.get_all_slicers(&id);
        assert_eq!(slicers.len(), 3);
        assert_eq!(
            slicers
                .iter()
                .map(|slicer| &slicer.name)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            3
        );
        assert_eq!(
            slicers
                .iter()
                .map(|slicer| &slicer.cache_name)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            2
        );
        let timelines: Vec<_> = engine
            .stores
            .storage
            .metadata
            .timelines
            .values()
            .filter(|timeline| timeline.sheet_id == id.to_uuid_string())
            .collect();
        assert_eq!(
            timelines
                .iter()
                .map(|timeline| &timeline.name)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            3
        );
        assert_eq!(
            timelines
                .iter()
                .map(|timeline| &timeline.cache_name)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            2
        );
    }
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let output = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap().0;
    assert_eq!(output.pivot_tables.len(), 3);
    assert_eq!(
        output
            .sheets
            .iter()
            .map(|sheet| sheet.sheet_id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        3
    );
    for pivot in &output.pivot_tables {
        let sheet = output
            .sheets
            .iter()
            .find(|sheet| sheet.name == pivot.config.output_sheet_name)
            .unwrap();
        let slicer_caches: Vec<_> = output
            .slicer_caches
            .iter()
            .filter(|cache| {
                cache
                    .pivot_tables
                    .iter()
                    .any(|reference| reference.name == pivot.config.name)
            })
            .collect();
        let timeline_caches: Vec<_> = output
            .timeline_caches
            .iter()
            .filter(|cache| {
                cache
                    .pivot_tables
                    .iter()
                    .any(|reference| reference.name == pivot.config.name)
            })
            .collect();
        assert_eq!(slicer_caches.len(), 2);
        assert_eq!(timeline_caches.len(), 2);
        for cache in slicer_caches {
            assert_eq!(Some(cache.pivot_tables[0].tab_id), sheet.sheet_id);
            assert_eq!(
                Some(cache.tabular_data.as_ref().unwrap().pivot_cache_id),
                pivot.config.cache_id
            );
        }
        for cache in timeline_caches {
            assert_eq!(Some(cache.pivot_tables[0].tab_id), sheet.sheet_id);
            assert_eq!(cache.pivot_cache_id, pivot.config.cache_id);
        }
    }
}

#[test]
fn copied_timeline_preserves_external_connections_when_the_source_cache_is_shared() {
    let source = sheet_id();
    let (mut engine, _) = ComputeEngine::from_snapshot(pivot_snapshot(source)).unwrap();
    let (report, _) = engine.create_sheet("Report").unwrap();
    let report = SheetId::from_uuid_str(&report).unwrap();
    create_region_sales_pivot_on_sheet(&mut engine, source, report, "Report", "ReportPivot");
    create_region_sales_pivot(&mut engine, source, "ExternalPivot");
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let source = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let report = engine.mirror().sheet_by_name("Report").unwrap();
    let pivot = engine.pivot_get_all(&report).pop().unwrap();
    let mut external = engine.pivot_get_all(&source).pop().unwrap();
    // Both reports use the same source data and are connected to one cache.
    external.cache_id = pivot.cache_id;
    engine
        .stores
        .storage
        .sheet_metadata
        .get_mut(&source)
        .unwrap()
        .pivots
        .get_mut(&external.id)
        .unwrap()
        .cache_id = pivot.cache_id;
    add_controls(
        &mut engine,
        report,
        &pivot,
        "Regions",
        "RegionCache",
        Some(&external),
    );
    let (copy, _) = engine.copy_sheet(&report, "CopiedReport").unwrap();
    let copy = SheetId::from_uuid_str(&copy).unwrap();
    let copied = engine.pivot_get_all(&copy).pop().unwrap();
    assert_eq!(copied.cache_id, pivot.cache_id);
    assert_eq!(copied.source_sheet_id, pivot.source_sheet_id);
    let timeline = engine
        .stores
        .storage
        .metadata
        .timelines
        .values()
        .find(|timeline| timeline.sheet_id == copy.to_uuid_string())
        .unwrap();
    let names: std::collections::HashSet<_> = timeline
        .cache
        .as_ref()
        .unwrap()
        .pivot_tables
        .iter()
        .map(|reference| reference.name.as_str())
        .collect();
    assert_eq!(
        names,
        std::collections::HashSet::from([copied.name.as_str(), external.name.as_str()])
    );
    let output = engine.export_to_parse_output().unwrap().parse_output;
    let cache = output
        .timeline_caches
        .iter()
        .find(|cache| cache.name == timeline.cache_name)
        .unwrap();
    assert_eq!(cache.pivot_tables.len(), 2);
    let sheet_ids = output.resolved_worksheet_ids().unwrap();
    for reference in &cache.pivot_tables {
        let pivot = output
            .pivot_tables
            .iter()
            .find(|pivot| pivot.config.name == reference.name)
            .unwrap();
        let index = output
            .sheets
            .iter()
            .position(|sheet| sheet.name == pivot.config.output_sheet_name)
            .unwrap();
        assert_eq!(reference.tab_id, sheet_ids[index]);
    }
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let reloaded = xlsx_parser::parse_xlsx_to_output(&bytes).unwrap().0;
    assert_eq!(
        reloaded
            .timeline_caches
            .iter()
            .find(|cache| cache.name == timeline.cache_name)
            .unwrap()
            .pivot_tables
            .len(),
        2
    );
}
