use super::runtime::{SortBy, SortOrder};

impl From<ooxml_types::tables::SortOrder> for SortOrder {
    fn from(order: ooxml_types::tables::SortOrder) -> Self {
        match order {
            ooxml_types::tables::SortOrder::Ascending => SortOrder::Asc,
            // Both None and Descending map; None defaults to Asc (ascending is the default sort).
            ooxml_types::tables::SortOrder::None => SortOrder::Asc,
            ooxml_types::tables::SortOrder::Descending => SortOrder::Desc,
        }
    }
}

impl From<SortOrder> for ooxml_types::tables::SortOrder {
    fn from(order: SortOrder) -> Self {
        match order {
            SortOrder::Asc => ooxml_types::tables::SortOrder::Ascending,
            SortOrder::Desc => ooxml_types::tables::SortOrder::Descending,
        }
    }
}

impl From<ooxml_types::tables::SortBy> for SortBy {
    fn from(sort_by: ooxml_types::tables::SortBy) -> Self {
        match sort_by {
            ooxml_types::tables::SortBy::Value => SortBy::Value,
            // CellColor and FontColor both collapse to Color in the runtime model.
            ooxml_types::tables::SortBy::CellColor | ooxml_types::tables::SortBy::FontColor => {
                SortBy::Color
            }
            ooxml_types::tables::SortBy::Icon => SortBy::Icon,
        }
    }
}

impl From<SortBy> for ooxml_types::tables::SortBy {
    fn from(sort_by: SortBy) -> Self {
        match sort_by {
            SortBy::Value => ooxml_types::tables::SortBy::Value,
            // Color expands to CellColor as the default (most common case).
            SortBy::Color => ooxml_types::tables::SortBy::CellColor,
            SortBy::Icon => ooxml_types::tables::SortBy::Icon,
        }
    }
}
