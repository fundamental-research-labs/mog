use super::{
    CONTENT_TYPE_CTRL_PROP, CT_CHART, CT_CHART_COLOR_STYLE, CT_CHART_EX, CT_CHART_STYLE,
    CT_COMMENTS, CT_CONNECTIONS, CT_DRAWING, CT_EMF, CT_FEATURE_PROPERTY_BAG, CT_GIF, CT_JPEG,
    CT_PIVOT_CACHE, CT_PIVOT_CACHE_RECORDS, CT_PIVOT_TABLE, CT_PNG, CT_QUERY_TABLE,
    CT_SLICER, CT_SLICER_CACHE, CT_TABLE, CT_TABLE_SINGLE_CELLS, CT_THREADED_COMMENTS,
    CT_VML_DRAWING,
    CT_VOLATILE_DEPENDENCIES, CT_WMF, CT_WORKSHEET_CUSTOM_PROPERTY, PackageGraphBuilder,
    PackageOwner, PackagePart, PackagePartKind, PackageRelationship, PackageRelationshipTarget,
    REL_CHART, REL_CHART_EX, REL_COMMENTS, REL_CONNECTIONS, REL_CTRL_PROP, REL_DRAWING,
    REL_EXTERNAL_LINK, REL_FEATURE_PROPERTY_BAG, REL_HYPERLINK, REL_IMAGE, REL_PIVOT_CACHE,
    REL_PIVOT_CACHE_DEFINITION, REL_PIVOT_CACHE_RECORDS, REL_PIVOT_TABLE, REL_PRINTER_SETTINGS,
    REL_QUERY_TABLE, REL_SLICER, REL_SLICER_CACHE, REL_TABLE, REL_TABLE_SINGLE_CELLS,
    REL_THREADED_COMMENT, REL_VML_DRAWING, REL_VOLATILE_DEPENDENCIES,
    REL_WORKSHEET_CUSTOM_PROPERTY, RelationshipIdentityHint, is_external_target_mode,
    modeled_part, normalize_external_link_part_path, normalize_part_path,
};
use crate::write::write_error::WriteError;

pub fn register_workbook_feature_property_bags(
    graph: &mut PackageGraphBuilder,
    feature_properties: &domain_types::WorkbookFeatureProperties,
) -> Result<(), WriteError> {
    if feature_properties.bags.is_empty() {
        return Ok(());
    }
    let package = feature_properties.package.as_ref();
    let path = package
        .map(|package| package.path.as_str())
        .unwrap_or(crate::domain::feature_property_bags::DEFAULT_FEATURE_PROPERTY_BAG_PATH);
    let relationship_type = package
        .map(|package| package.workbook_relationship_type.as_str())
        .filter(|relationship_type| !relationship_type.is_empty())
        .unwrap_or(REL_FEATURE_PROPERTY_BAG);
    graph.register_part(modeled_part(path, CT_FEATURE_PROPERTY_BAG))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(path),
        },
        identity_hint: package
            .and_then(|package| package.workbook_relationship_id.as_deref())
            .map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_workbook_external_link(
    graph: &mut PackageGraphBuilder,
    part_name: &str,
    identity_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = normalize_external_link_part_path(part_name);
    graph.register_part(modeled_part(
        &path,
        crate::domain::external::write::CT_EXTERNAL_LINK,
    ))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_EXTERNAL_LINK.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: identity_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_external_link_relationship(
    graph: &mut PackageGraphBuilder,
    part_name: &str,
    relationship_type: &str,
    target: &str,
    identity_hint: Option<&str>,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_external_link_part_path(part_name),
        },
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::External {
            target: target.to_string(),
        },
        identity_hint: identity_hint.map(RelationshipIdentityHint::new),
    });
}

pub fn register_generated_pivot_cache(
    graph: &mut PackageGraphBuilder,
    global_idx: usize,
) -> Result<(), WriteError> {
    let definition_path = format!("xl/pivotCache/pivotCacheDefinition{global_idx}.xml");
    let records_path = format!("xl/pivotCache/pivotCacheRecords{global_idx}.xml");
    register_pivot_cache(
        graph,
        &definition_path,
        Some(&records_path),
        REL_PIVOT_CACHE,
        None,
        Some(REL_PIVOT_CACHE_RECORDS),
        None,
    )
}

pub fn register_pivot_cache(
    graph: &mut PackageGraphBuilder,
    definition_path: &str,
    records_path: Option<&str>,
    workbook_relationship_type: &str,
    workbook_relationship_id_hint: Option<&str>,
    records_relationship_type: Option<&str>,
    records_relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(definition_path, CT_PIVOT_CACHE))?;
    if let Some(records_path) = records_path {
        graph.register_part(modeled_part(records_path, CT_PIVOT_CACHE_RECORDS))?;
    }
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: workbook_relationship_type.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: definition_path.to_string(),
        },
        identity_hint: workbook_relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    if let (Some(records_path), Some(records_relationship_type)) =
        (records_path, records_relationship_type)
    {
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Part {
                path: definition_path.to_string(),
            },
            relationship_type: records_relationship_type.to_string(),
            target: PackageRelationshipTarget::InternalPart {
                path: records_path.to_string(),
            },
            identity_hint: records_relationship_id_hint.map(RelationshipIdentityHint::new),
        });
    }
    Ok(())
}

pub fn register_worksheet_table(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/tables/table{global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_TABLE))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        },
        relationship_type: REL_TABLE.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_table_single_cells(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/tables/tableSingleCells{global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_TABLE_SINGLE_CELLS))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Worksheet {
            index: sheet_idx,
            path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
        },
        relationship_type: REL_TABLE_SINGLE_CELLS.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_workbook_connections(graph: &mut PackageGraphBuilder) -> Result<(), WriteError> {
    graph.register_part(modeled_part("xl/connections.xml", CT_CONNECTIONS))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_CONNECTIONS.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: "xl/connections.xml".to_string(),
        },
        identity_hint: None,
    });
    Ok(())
}

pub fn register_workbook_volatile_dependencies(
    graph: &mut PackageGraphBuilder,
    part: &domain_types::VolatileDependencyPackagePart,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(&part.path, CT_VOLATILE_DEPENDENCIES))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: if part.relationship_type.is_empty() {
            REL_VOLATILE_DEPENDENCIES.to_string()
        } else {
            part.relationship_type.clone()
        },
        target: PackageRelationshipTarget::InternalPart {
            path: part.path.clone(),
        },
        identity_hint: part
            .relationship_id
            .as_deref()
            .map(RelationshipIdentityHint::new),
    });
    for hint in &part.relationships {
        if !is_external_target_mode(hint.target_mode.as_deref()) {
            continue;
        }
        graph.add_relationship(PackageRelationship {
            owner: PackageOwner::Part {
                path: part.path.clone(),
            },
            relationship_type: hint.relationship_type.clone(),
            target: PackageRelationshipTarget::External {
                target: hint.target.clone(),
            },
            identity_hint: Some(RelationshipIdentityHint::new(hint.id.as_str())),
        });
    }
    Ok(())
}

pub fn register_table_query_table(
    graph: &mut PackageGraphBuilder,
    table_global_idx: usize,
    query_table_global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/queryTables/queryTable{query_table_global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_QUERY_TABLE))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: format!("xl/tables/table{table_global_idx}.xml"),
        },
        relationship_type: REL_QUERY_TABLE.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_slicer(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/slicers/slicer{global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_SLICER))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_SLICER.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_workbook_slicer_cache(
    graph: &mut PackageGraphBuilder,
    global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/slicerCaches/slicerCache{global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_SLICER_CACHE))?;
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Workbook,
        relationship_type: REL_SLICER_CACHE.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_drawing(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    drawing_path: &str,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(drawing_path, CT_DRAWING))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_DRAWING.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: drawing_path.to_string(),
        },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_chart(
    graph: &mut PackageGraphBuilder,
    global_idx: usize,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(
        &format!("xl/charts/chart{global_idx}.xml"),
        CT_CHART,
    ))
}

pub fn register_chart_ex(
    graph: &mut PackageGraphBuilder,
    global_idx: usize,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(
        &format!("xl/charts/chartEx{global_idx}.xml"),
        CT_CHART_EX,
    ))
}

pub fn register_chart_auxiliary_part(
    graph: &mut PackageGraphBuilder,
    path: &str,
) -> Result<(), WriteError> {
    let Some(content_type) = chart_auxiliary_content_type(path) else {
        return Ok(());
    };
    graph.register_part(modeled_part(path, content_type))
}

pub fn is_supported_chart_auxiliary_part(path: &str) -> bool {
    chart_auxiliary_content_type(path).is_some()
}

fn chart_auxiliary_content_type(path: &str) -> Option<&'static str> {
    let normalized = normalize_part_path(path);
    if normalized.starts_with("xl/drawings/") && normalized.ends_with(".xml") {
        Some(CT_DRAWING)
    } else if normalized.contains("style") {
        Some(CT_CHART_STYLE)
    } else if normalized.contains("colors") || normalized.contains("color") {
        Some(CT_CHART_COLOR_STYLE)
    } else {
        None
    }
}

pub fn register_chart_auxiliary_relationship(
    graph: &mut PackageGraphBuilder,
    chart_path: &str,
    relationship_type: &str,
    target_path: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(chart_path),
        },
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(target_path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

pub fn register_chart_external_relationship(
    graph: &mut PackageGraphBuilder,
    chart_path: &str,
    relationship_type: &str,
    target: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(chart_path),
        },
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::External {
            target: target.to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

pub fn register_media_part(graph: &mut PackageGraphBuilder, path: &str) -> Result<(), WriteError> {
    let extension = path
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_else(|| "png".to_string());
    let content_type = match extension.as_str() {
        "png" => CT_PNG.to_string(),
        "jpg" | "jpeg" => CT_JPEG.to_string(),
        "gif" => CT_GIF.to_string(),
        "bmp" => "image/bmp".to_string(),
        "tif" | "tiff" => "image/tiff".to_string(),
        "emf" => CT_EMF.to_string(),
        "wmf" => CT_WMF.to_string(),
        other => format!("image/{other}"),
    };
    graph.register_part(PackagePart {
        path: normalize_part_path(path),
        content_type: None,
        default_extension: Some((extension, content_type)),
        kind: PackagePartKind::Modeled,
        bytes: None,
    })
}

pub fn register_ole_embedding_part(
    graph: &mut PackageGraphBuilder,
    path: &str,
    content_type: &str,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(path, content_type))
}

pub fn register_worksheet_ole_object(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    embedding_path: &str,
    relationship_type: &str,
    relationship_id_hint: Option<&str>,
) {
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(embedding_path),
        },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
}

pub fn register_drawing_chart_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    chart_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    register_drawing_relationship(
        graph,
        drawing_path,
        REL_CHART,
        chart_path,
        relationship_id_hint,
    )
}

pub fn register_drawing_chart_ex_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    chart_ex_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    register_drawing_relationship(
        graph,
        drawing_path,
        REL_CHART_EX,
        chart_ex_path,
        relationship_id_hint,
    )
}

pub fn register_drawing_image_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    image_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    register_drawing_relationship(
        graph,
        drawing_path,
        REL_IMAGE,
        image_path,
        relationship_id_hint,
    )
}

pub fn register_part_image_relationship(
    graph: &mut PackageGraphBuilder,
    owner_path: &str,
    image_path: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(owner_path),
        },
        relationship_type: REL_IMAGE.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(image_path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

fn register_drawing_relationship(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    relationship_type: &str,
    target_path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(drawing_path),
        },
        relationship_type: relationship_type.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(target_path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_drawing_relationship_with_target_mode(
    graph: &mut PackageGraphBuilder,
    drawing_path: &str,
    relationship_type: &str,
    target: &str,
    target_mode: Option<&str>,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    let target = if is_external_target_mode(target_mode) {
        PackageRelationshipTarget::External {
            target: target.to_string(),
        }
    } else if relationship_type == REL_HYPERLINK && target.starts_with('#') {
        PackageRelationshipTarget::InternalPath {
            target: target.to_string(),
        }
    } else {
        PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(target),
        }
    };
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: normalize_part_path(drawing_path),
        },
        relationship_type: relationship_type.to_string(),
        target,
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_worksheet_hyperlink(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    target: &str,
    target_mode: Option<&str>,
    relationship_id_hint: &str,
) {
    let target = if is_external_target_mode(target_mode) {
        PackageRelationshipTarget::External {
            target: target.to_string(),
        }
    } else if target.starts_with('#') {
        PackageRelationshipTarget::InternalPath {
            target: target.to_string(),
        }
    } else {
        PackageRelationshipTarget::External {
            target: target.to_string(),
        }
    };
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_HYPERLINK.to_string(),
        target,
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

pub fn register_worksheet_control_property(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    let path = format!("xl/ctrlProps/ctrlProp{global_idx}.xml");
    graph.register_part(modeled_part(&path, CONTENT_TYPE_CTRL_PROP))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_CTRL_PROP.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_worksheet_custom_property(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    path: &str,
    relationship_id_hint: &str,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(path, CT_WORKSHEET_CUSTOM_PROPERTY))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_WORKSHEET_CUSTOM_PROPERTY.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: normalize_part_path(path),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
    Ok(())
}

pub fn register_worksheet_printer_settings(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    path: &str,
    relationship_id_hint: &str,
) {
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_PRINTER_SETTINGS.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: path.to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new(relationship_id_hint)),
    });
}

pub fn register_worksheet_comments(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    comments_path: &str,
    comments_relationship_id_hint: Option<&str>,
    vml_path: &str,
    vml_relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(comments_path, CT_COMMENTS))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_COMMENTS.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: comments_path.to_string(),
        },
        identity_hint: comments_relationship_id_hint.map(RelationshipIdentityHint::new),
    });

    graph.register_part(PackagePart {
        path: normalize_part_path(vml_path),
        content_type: None,
        default_extension: Some(("vml".to_string(), CT_VML_DRAWING.to_string())),
        kind: PackagePartKind::Modeled,
        bytes: None,
    })?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_VML_DRAWING.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: vml_path.to_string(),
        },
        identity_hint: vml_relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_vml_drawing(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    vml_path: &str,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(PackagePart {
        path: normalize_part_path(vml_path),
        content_type: None,
        default_extension: Some(("vml".to_string(), CT_VML_DRAWING.to_string())),
        kind: PackagePartKind::Modeled,
        bytes: None,
    })?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_VML_DRAWING.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: vml_path.to_string(),
        },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_worksheet_threaded_comments(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    threaded_comments_path: &str,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    graph.register_part(modeled_part(threaded_comments_path, CT_THREADED_COMMENTS))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_THREADED_COMMENT.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: threaded_comments_path.to_string(),
        },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_generated_worksheet_pivot_table(
    graph: &mut PackageGraphBuilder,
    sheet_idx: usize,
    global_idx: usize,
    relationship_id_hint: Option<&str>,
) -> Result<(), WriteError> {
    let path = format!("xl/pivotTables/pivotTable{global_idx}.xml");
    graph.register_part(modeled_part(&path, CT_PIVOT_TABLE))?;
    graph.add_relationship(PackageRelationship {
        owner: worksheet_owner(sheet_idx),
        relationship_type: REL_PIVOT_TABLE.to_string(),
        target: PackageRelationshipTarget::InternalPart { path },
        identity_hint: relationship_id_hint.map(RelationshipIdentityHint::new),
    });
    Ok(())
}

pub fn register_generated_pivot_table_cache_relationship(
    graph: &mut PackageGraphBuilder,
    pivot_table_global_idx: usize,
    cache_definition_global_idx: usize,
    relationship_id_hint: Option<&str>,
) {
    register_pivot_table_cache_relationship(
        graph,
        pivot_table_global_idx,
        &format!("xl/pivotCache/pivotCacheDefinition{cache_definition_global_idx}.xml"),
        relationship_id_hint,
    );
}

pub fn register_pivot_table_cache_relationship(
    graph: &mut PackageGraphBuilder,
    pivot_table_global_idx: usize,
    cache_definition_path: &str,
    relationship_id_hint: Option<&str>,
) {
    graph.add_relationship(PackageRelationship {
        owner: PackageOwner::Part {
            path: format!("xl/pivotTables/pivotTable{pivot_table_global_idx}.xml"),
        },
        relationship_type: REL_PIVOT_CACHE_DEFINITION.to_string(),
        target: PackageRelationshipTarget::InternalPart {
            path: cache_definition_path.to_string(),
        },
        identity_hint: Some(RelationshipIdentityHint::new(
            relationship_id_hint.unwrap_or("rId1"),
        )),
    });
}

fn worksheet_owner(sheet_idx: usize) -> PackageOwner {
    PackageOwner::Worksheet {
        index: sheet_idx,
        path: format!("xl/worksheets/sheet{}.xml", sheet_idx + 1),
    }
}
