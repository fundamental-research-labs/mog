use crate::domain::timelines::read::timeline_level_attr;
use crate::write::xml_writer::XmlWriter;

const NS_X15: &str = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main";
const NS_X: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_XR10: &str = "http://schemas.microsoft.com/office/spreadsheetml/2016/revision10";

pub fn write_timeline_part(timelines: &[ooxml_types::timelines::TimelineDef]) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();
    w.start_element("timelines")
        .attr("xmlns", NS_X15)
        .attr("xmlns:mc", NS_MC)
        .attr("mc:Ignorable", "x xr10")
        .attr("xmlns:x", NS_X)
        .attr("xmlns:xr10", NS_XR10)
        .end_attrs();
    for timeline in timelines {
        w.start_element("timeline").attr("name", &timeline.name);
        if let Some(uid) = &timeline.uid {
            w.attr("xr10:uid", uid);
        }
        w.attr("cache", &timeline.cache);
        if let Some(caption) = &timeline.caption {
            w.attr("caption", caption);
        }
        w.attr("level", timeline_level_attr(timeline.level));
        if let Some(selection_level) = timeline.selection_level {
            w.attr("selectionLevel", timeline_level_attr(selection_level));
        }
        if let Some(scroll_position) = &timeline.scroll_position {
            w.attr("scrollPosition", scroll_position);
        }
        if let Some(ext_lst) = &timeline.ext_lst {
            w.end_attrs();
            w.raw_str(ext_lst);
            w.end_element("timeline");
        } else {
            w.self_close();
        }
    }
    w.end_element("timelines");
    w.finish()
}

pub fn write_timeline_cache(cache: &ooxml_types::timelines::TimelineCacheDef) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();
    w.start_element("timelineCacheDefinition")
        .attr("xmlns", NS_X15)
        .attr("xmlns:x15", NS_X15)
        .attr("xmlns:mc", NS_MC)
        .attr("mc:Ignorable", "xr10")
        .attr("xmlns:xr10", NS_XR10)
        .attr("name", &cache.name);
    if let Some(uid) = &cache.uid {
        w.attr("xr10:uid", uid);
    }
    w.attr("sourceName", &cache.source_name).end_attrs();
    w.start_element("state");
    if let Some(value) = cache.minimal_refresh_version {
        w.attr("minimalRefreshVersion", &value.to_string());
    }
    if let Some(value) = cache.last_refresh_version {
        w.attr("lastRefreshVersion", &value.to_string());
    }
    if let Some(value) = cache.pivot_cache_id {
        w.attr("pivotCacheId", &value.to_string());
    }
    if let Some(value) = &cache.filter_type {
        w.attr("filterType", value);
    }
    let has_bounds = cache.start_date.is_some() || cache.end_date.is_some();
    if has_bounds {
        w.end_attrs();
        w.start_element("bounds");
        if let Some(value) = &cache.start_date {
            w.attr("startDate", value);
        }
        if let Some(value) = &cache.end_date {
            w.attr("endDate", value);
        }
        w.self_close();
        w.end_element("state");
    } else {
        w.self_close();
    }
    if let Some(ext_lst) = &cache.ext_lst {
        w.raw_str(ext_lst);
    }
    w.end_element("timelineCacheDefinition");
    w.finish()
}

pub fn write_worksheet_timeline_ext(w: &mut XmlWriter, r_id: &str) {
    w.start_element("ext")
        .attr("uri", "{7E03D99C-DC04-49d9-9315-930204A7B6E9}")
        .attr("xmlns:x15", NS_X15)
        .end_attrs();
    w.start_element("x15:timelineRefs").end_attrs();
    w.start_element("x15:timelineRef")
        .attr("r:id", r_id)
        .self_close();
    w.end_element("x15:timelineRefs");
    w.end_element("ext");
}
