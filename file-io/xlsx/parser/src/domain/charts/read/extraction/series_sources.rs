pub(super) fn extract_num_point_cache(
    src: &Option<ooxml_types::charts::NumDataSource>,
) -> Option<domain_types::chart::ChartSeriesPointCacheData> {
    use ooxml_types::charts::NumDataSource;

    let data = match src.as_ref()? {
        NumDataSource::Ref(num_ref) => num_ref.num_cache.as_ref()?,
        NumDataSource::Lit(num_data) => num_data,
    };
    Some(num_data_to_point_cache(data))
}

pub(super) fn extract_num_source_kind(
    src: &Option<ooxml_types::charts::NumDataSource>,
) -> Option<domain_types::chart::ChartSeriesDimensionSourceKindData> {
    use ooxml_types::charts::NumDataSource;

    match src.as_ref()? {
        NumDataSource::Ref(_) => Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref),
        NumDataSource::Lit(_) => {
            Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Literal)
        }
    }
}

pub(super) fn extract_cat_point_cache(
    src: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::ChartSeriesPointCacheData> {
    use ooxml_types::charts::CatDataSource;

    match src.as_ref()? {
        CatDataSource::NumRef(num_ref) => num_ref.num_cache.as_ref().map(num_data_to_point_cache),
        CatDataSource::NumLit(num_data) => Some(num_data_to_point_cache(num_data)),
        CatDataSource::StrRef(str_ref) => str_ref.str_cache.as_ref().map(str_data_to_point_cache),
        CatDataSource::StrLit(str_data) => Some(str_data_to_point_cache(str_data)),
        CatDataSource::MultiLvlStrRef(_) => None,
    }
}

pub(super) fn extract_cat_source_kind(
    src: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::ChartSeriesDimensionSourceKindData> {
    use ooxml_types::charts::CatDataSource;

    match src.as_ref()? {
        CatDataSource::NumRef(_) | CatDataSource::StrRef(_) | CatDataSource::MultiLvlStrRef(_) => {
            Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref)
        }
        CatDataSource::NumLit(_) | CatDataSource::StrLit(_) => {
            Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Literal)
        }
    }
}

pub(super) fn extract_cat_source_type(
    src: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::ChartSeriesCategorySourceTypeData> {
    use domain_types::chart::ChartSeriesCategorySourceTypeData;
    use ooxml_types::charts::CatDataSource;

    match src.as_ref()? {
        CatDataSource::NumRef(_) | CatDataSource::NumLit(_) => {
            Some(ChartSeriesCategorySourceTypeData::Number)
        }
        CatDataSource::StrRef(_) | CatDataSource::StrLit(_) => {
            Some(ChartSeriesCategorySourceTypeData::String)
        }
        CatDataSource::MultiLvlStrRef(_) => {
            Some(ChartSeriesCategorySourceTypeData::MultiLevelString)
        }
    }
}

pub(super) fn extract_cat_level_cache(
    src: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::ChartSeriesCategoryLevelsCacheData> {
    use ooxml_types::charts::CatDataSource;

    match src.as_ref()? {
        CatDataSource::MultiLvlStrRef(multi_lvl_ref) => multi_lvl_ref
            .multi_lvl_str_cache
            .as_ref()
            .map(multi_lvl_str_data_to_category_levels_cache),
        _ => None,
    }
}

fn multi_lvl_str_data_to_category_levels_cache(
    data: &ooxml_types::charts::MultiLvlStrData,
) -> domain_types::chart::ChartSeriesCategoryLevelsCacheData {
    domain_types::chart::ChartSeriesCategoryLevelsCacheData {
        point_count: data.pt_count,
        levels: data
            .levels
            .iter()
            .enumerate()
            .map(
                |(level, level_data)| domain_types::chart::ChartSeriesCategoryLevelCacheData {
                    level: level as u32,
                    point_count: level_data.pt_count,
                    points: level_data
                        .pts
                        .iter()
                        .map(
                            |point| domain_types::chart::ChartSeriesPointCachePointData {
                                idx: point.idx,
                                value: point.v.clone(),
                                format_code: None,
                            },
                        )
                        .collect(),
                },
            )
            .collect(),
    }
}

pub(super) fn num_data_to_point_cache(
    data: &ooxml_types::charts::NumData,
) -> domain_types::chart::ChartSeriesPointCacheData {
    domain_types::chart::ChartSeriesPointCacheData {
        point_count: data.pt_count,
        format_code: data.format_code.clone(),
        points: data
            .pts
            .iter()
            .map(
                |point| domain_types::chart::ChartSeriesPointCachePointData {
                    idx: point.idx,
                    value: point.v.clone(),
                    format_code: point.format_code.clone(),
                },
            )
            .collect(),
    }
}

fn str_data_to_point_cache(
    data: &ooxml_types::charts::StrData,
) -> domain_types::chart::ChartSeriesPointCacheData {
    domain_types::chart::ChartSeriesPointCacheData {
        point_count: data.pt_count,
        format_code: None,
        points: data
            .pts
            .iter()
            .map(
                |point| domain_types::chart::ChartSeriesPointCachePointData {
                    idx: point.idx,
                    value: point.v.clone(),
                    format_code: None,
                },
            )
            .collect(),
    }
}

pub(super) fn extract_category_label_format(
    cat: &Option<ooxml_types::charts::CatDataSource>,
) -> Option<domain_types::chart::CategoryLabelFormatData> {
    use ooxml_types::charts::CatDataSource;

    let num_data = match cat {
        Some(CatDataSource::NumRef(num_ref)) => num_ref.num_cache.as_ref(),
        Some(CatDataSource::NumLit(num_data)) => Some(num_data),
        _ => None,
    }?;

    let points: Vec<domain_types::chart::CategoryPointLabelFormatData> = num_data
        .pts
        .iter()
        .filter_map(|point| {
            point.format_code.as_ref().map(|format_code| {
                domain_types::chart::CategoryPointLabelFormatData {
                    idx: point.idx,
                    format_code: Some(format_code.clone()),
                }
            })
        })
        .collect();

    if num_data.format_code.is_none() && points.is_empty() {
        return None;
    }

    Some(domain_types::chart::CategoryLabelFormatData {
        format_code: num_data.format_code.clone(),
        points: if points.is_empty() {
            None
        } else {
            Some(points)
        },
    })
}
