//! Pivot functional fact extraction.
//!
//! Facts are deterministic fingerprints of the semantic pivot surface. They are
//! intentionally smaller than the raw read model so parser, writer, and
//! read/write tests can assert behavior without comparing incidental XML shape.

use crate::domain::pivot::model::{
    CacheRecordValue, PivotCache, PivotField, PivotItem, PivotTable, SharedItem,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotFacts {
    pub table: Option<PivotTableFacts>,
    pub cache: Option<PivotCacheFacts>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotTableFacts {
    pub name: String,
    pub cache_id: u32,
    pub data_on_rows: bool,
    pub location_ref: Option<String>,
    pub first_header_row: u32,
    pub first_data_row: u32,
    pub first_data_col: u32,
    pub row_fields: Vec<i32>,
    pub col_fields: Vec<i32>,
    pub page_fields: Vec<PageFieldFacts>,
    pub data_fields: Vec<DataFieldFacts>,
    pub pivot_fields: Vec<PivotFieldFacts>,
    pub style_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageFieldFacts {
    pub field_index: i32,
    pub item: Option<u32>,
    pub hierarchy: Option<i32>,
    pub name: Option<String>,
    pub caption: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataFieldFacts {
    pub name: Option<String>,
    pub field_index: u32,
    pub subtotal: String,
    pub num_fmt_id: Option<u32>,
    pub base_field: Option<i32>,
    pub base_item: Option<u32>,
    pub show_data_as: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotFieldFacts {
    pub index: u32,
    pub name: Option<String>,
    pub axis: Option<String>,
    pub sort_type: Option<String>,
    pub auto_sort_data_field: Option<u32>,
    pub data_field: bool,
    pub show_all: Option<bool>,
    pub items: Vec<PivotItemFacts>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotItemFacts {
    pub item_type: String,
    pub x: Option<u32>,
    pub hidden: bool,
    pub show_details: bool,
    pub s: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotCacheFacts {
    pub id: u32,
    pub source_type: String,
    pub source_ref: Option<String>,
    pub source_sheet: Option<String>,
    pub field_names: Vec<String>,
    pub fields: Vec<CacheFieldFacts>,
    pub records: Vec<Vec<String>>,
    pub record_count: Option<u32>,
    pub refresh_on_load: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheFieldFacts {
    pub name: String,
    pub shared_items: Vec<String>,
    pub num_fmt_id: Option<u32>,
    pub sql_type: Option<i32>,
    pub caption: Option<String>,
}

pub fn extract_pivot_facts(table: Option<&PivotTable>, cache: Option<&PivotCache>) -> PivotFacts {
    PivotFacts {
        table: table.map(extract_pivot_table_facts),
        cache: cache.map(extract_pivot_cache_facts),
    }
}

pub fn extract_pivot_table_facts(table: &PivotTable) -> PivotTableFacts {
    PivotTableFacts {
        name: table.name.clone(),
        cache_id: table.cache_id,
        data_on_rows: table.data_on_rows,
        location_ref: table
            .location
            .ref_
            .as_ref()
            .map(|range| range.to_a1_string()),
        first_header_row: table.location.first_header_row,
        first_data_row: table.location.first_data_row,
        first_data_col: table.location.first_data_col,
        row_fields: table.row_fields.iter().map(|field| field.x).collect(),
        col_fields: table.col_fields.iter().map(|field| field.x).collect(),
        page_fields: table
            .page_fields
            .iter()
            .map(|field| PageFieldFacts {
                field_index: field.field_index,
                item: field.item,
                hierarchy: field.hierarchy,
                name: field.name.clone(),
                caption: field.caption.clone(),
            })
            .collect(),
        data_fields: table
            .data_fields
            .iter()
            .map(|field| DataFieldFacts {
                name: field.name.clone(),
                field_index: field.field_index,
                subtotal: format!("{:?}", field.subtotal),
                num_fmt_id: field.num_fmt_id,
                base_field: field.base_field,
                base_item: field.base_item,
                show_data_as: field.show_data_as.clone(),
            })
            .collect(),
        pivot_fields: table.pivot_fields.iter().map(pivot_field_facts).collect(),
        style_name: table
            .style_info
            .as_ref()
            .and_then(|style| style.name.clone()),
    }
}

pub fn extract_pivot_cache_facts(cache: &PivotCache) -> PivotCacheFacts {
    PivotCacheFacts {
        id: cache.id,
        source_type: format!("{:?}", cache.source_type),
        source_ref: cache.source_ref.clone(),
        source_sheet: cache.source_sheet.clone(),
        field_names: cache
            .fields
            .iter()
            .map(|field| field.name.clone())
            .collect(),
        fields: cache
            .fields
            .iter()
            .map(|field| CacheFieldFacts {
                name: field.name.clone(),
                shared_items: field.shared_items.iter().map(shared_item_fact).collect(),
                num_fmt_id: field.num_fmt_id,
                sql_type: field.sql_type,
                caption: field.caption.clone(),
            })
            .collect(),
        records: cache
            .records
            .iter()
            .map(|record| record.values.iter().map(cache_record_value_fact).collect())
            .collect(),
        record_count: cache.record_count,
        refresh_on_load: cache.refresh_on_load,
    }
}

fn pivot_field_facts(field: &PivotField) -> PivotFieldFacts {
    PivotFieldFacts {
        index: field.index,
        name: field.name.clone(),
        axis: field.axis.map(|axis| format!("{axis:?}")),
        sort_type: field.sort_type.map(|sort| format!("{sort:?}")),
        auto_sort_data_field: field.auto_sort_data_field,
        data_field: field.data_field,
        show_all: field.show_all,
        items: field.items.iter().map(pivot_item_facts).collect(),
    }
}

fn pivot_item_facts(item: &PivotItem) -> PivotItemFacts {
    PivotItemFacts {
        item_type: format!("{:?}", item.item_type),
        x: item.x,
        hidden: item.hidden,
        show_details: item.show_details,
        s: item.s.clone(),
    }
}

fn shared_item_fact(item: &SharedItem) -> String {
    match item {
        SharedItem::String(value) => format!("s:{value}"),
        SharedItem::Number(value) => format!("n:{value}"),
        SharedItem::Boolean(value) => format!("b:{value}"),
        SharedItem::Error(value) => format!("e:{value}"),
        SharedItem::DateTime(value) => format!("d:{value}"),
        SharedItem::Missing => "m:".to_string(),
    }
}

fn cache_record_value_fact(value: &CacheRecordValue) -> String {
    match value {
        CacheRecordValue::Index(value) => format!("x:{value}"),
        CacheRecordValue::Number(value) => format!("n:{value}"),
        CacheRecordValue::String(value) => format!("s:{value}"),
        CacheRecordValue::Boolean(value) => format!("b:{value}"),
        CacheRecordValue::Error(value) => format!("e:{value}"),
        CacheRecordValue::DateTime(value) => format!("d:{value}"),
        CacheRecordValue::Missing => "m:".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::parse::{parse_pivot_cache_definition, parse_pivot_table};
    use crate::domain::pivot::write::convert::pivot_table_to_writer;

    #[test]
    fn table_facts_capture_semantic_surface() {
        let table = parse_pivot_table(
            br#"<pivotTableDefinition name="Pivot1" cacheId="4" dataOnRows="1">
                <location ref="A3:C8" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>
                <pivotFields count="1">
                    <pivotField axis="axisRow" showAll="1" sortType="ascending">
                        <items count="2"><item x="0"/><item x="1" h="1" sd="0"/></items>
                    </pivotField>
                </pivotFields>
                <rowFields count="1"><field x="0"/></rowFields>
                <dataFields count="1"><dataField name="Sum of Sales" fld="0" subtotal="sum" numFmtId="4"/></dataFields>
                <pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1"/>
            </pivotTableDefinition>"#,
        );

        let facts = extract_pivot_table_facts(&table);

        assert_eq!(facts.name, "Pivot1");
        assert_eq!(facts.cache_id, 4);
        assert_eq!(facts.location_ref.as_deref(), Some("A3:C8"));
        assert_eq!(facts.row_fields, vec![0]);
        assert_eq!(facts.data_fields[0].name.as_deref(), Some("Sum of Sales"));
        assert_eq!(facts.pivot_fields[0].axis.as_deref(), Some("Row"));
        assert!(facts.pivot_fields[0].items[1].hidden);
    }

    #[test]
    fn writer_supported_table_facts_survive_read_write_read() {
        let original = parse_pivot_table(
            br#"<pivotTableDefinition name="Pivot1" cacheId="4" dataOnRows="1">
                <location ref="A3:C8" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>
                <pivotFields count="2">
                    <pivotField axis="axisRow" showAll="1" sortType="ascending">
                        <items count="2"><item x="0"/><item x="1" h="1" sd="0"/></items>
                    </pivotField>
                    <pivotField axis="axisValues" dataField="1"/>
                </pivotFields>
                <rowFields count="1"><field x="0"/></rowFields>
                <dataFields count="1"><dataField name="Sum of Sales" fld="1" subtotal="sum" numFmtId="4"/></dataFields>
                <pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1"/>
            </pivotTableDefinition>"#,
        );

        let writer = pivot_table_to_writer(&original);
        let emitted = writer.to_xml();
        let reparsed = parse_pivot_table(&emitted);

        assert_eq!(
            extract_pivot_table_facts(&original),
            extract_pivot_table_facts(&reparsed)
        );
    }

    #[test]
    fn cache_facts_track_source_and_shared_items() {
        let cache = parse_pivot_cache_definition(
            br#"<pivotCacheDefinition recordCount="2" refreshOnLoad="1">
                <cacheSource type="worksheet"><worksheetSource ref="A1:B3" sheet="Data"/></cacheSource>
                <cacheFields count="1">
                    <cacheField name="Region" numFmtId="0"><sharedItems count="2"><s v="West"/><s v="East"/></sharedItems></cacheField>
                </cacheFields>
            </pivotCacheDefinition>"#,
        );

        let facts = extract_pivot_cache_facts(&cache);

        assert_eq!(facts.source_type, "Worksheet");
        assert_eq!(facts.source_ref.as_deref(), Some("A1:B3"));
        assert_eq!(facts.source_sheet.as_deref(), Some("Data"));
        assert_eq!(facts.field_names, vec!["Region"]);
        assert_eq!(facts.fields[0].shared_items, vec!["s:West", "s:East"]);
    }
}
