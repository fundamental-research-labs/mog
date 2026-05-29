//! Main DrawingWriter struct and core methods for drawing XML generation.
//!
//! This module contains the DrawingWriter builder and its implementation
//! for generating DrawingML XML files.
//!
//! The implementation is split across submodules by concern:
//! - `objects` — Object type writers (picture, shape, chart, connector, etc.)
//! - `text` — Rich text body, paragraphs, run properties, bullets
//! - `styling` — Fills, outlines, effects, hyperlinks, style references

use std::collections::{HashMap, HashSet};

mod objects;
mod styling;
mod text;

// Re-export pub(crate) free functions from styling
#[cfg(test)]
pub(crate) use styling::{write_scene3d, write_shape3d};

use crate::write::xml_writer::XmlWriter;

use super::types::{
    CellAnchor, ChartRef, ClientData, ConnectorProps, DrawingAnchor, DrawingObject, Extent,
    ImageProps, NS_A, NS_A14, NS_CX, NS_MC, NS_R, NS_SLE, NS_XDR, OneCellAnchor, ShapeProps,
    TextBox, TwoCellAnchor,
};

// ============================================================================
// Drawing Writer
// ============================================================================

/// Drawing writer for generating DrawingML XML
#[derive(Debug, Clone, Default)]
pub struct DrawingWriter {
    /// All drawing anchors
    anchors: Vec<DrawingAnchor>,
    /// Original root element namespace declarations for round-trip fidelity.
    /// Each entry is (attr_name, attr_value), e.g. ("xmlns:xdr", "http://...").
    /// When set, these are emitted instead of the hardcoded defaults.
    root_namespace_attrs: Vec<(String, String)>,
    suppress_unregistered_relationships: bool,
    registered_relationship_ids: HashSet<String>,
}

impl DrawingWriter {
    pub(super) fn write_raw_xml_if_relationship_safe(w: &mut XmlWriter, raw_xml: &str) -> bool {
        if crate::infra::xml::raw_xml_contains_relationship_attr(raw_xml) {
            return false;
        }
        w.raw_str(raw_xml);
        true
    }

    pub(super) fn write_raw_xml(&self, w: &mut XmlWriter, raw_xml: &str) -> bool {
        if self.suppress_unregistered_relationships {
            let relationship_ids = crate::infra::xml::relationship_attr_values(raw_xml);
            if !relationship_ids.is_empty()
                && relationship_ids
                    .iter()
                    .all(|id| self.registered_relationship_ids.contains(id))
            {
                w.raw_str(raw_xml);
                return true;
            }
            return Self::write_raw_xml_if_relationship_safe(w, raw_xml);
        }
        w.raw_str(raw_xml);
        true
    }

    /// Create a new drawing writer
    pub fn new() -> Self {
        Self {
            anchors: Vec::new(),
            root_namespace_attrs: Vec::new(),
            suppress_unregistered_relationships: false,
            registered_relationship_ids: HashSet::new(),
        }
    }

    pub fn set_suppress_unregistered_relationships(&mut self, suppress: bool) {
        self.suppress_unregistered_relationships = suppress;
    }

    pub(super) fn can_write_relationship_id(&self, r_id: &str) -> bool {
        !self.suppress_unregistered_relationships || self.registered_relationship_ids.contains(r_id)
    }

    /// Set the original root element namespace declarations for round-trip fidelity.
    ///
    /// When set, these declarations are emitted on the root `<xdr:wsDr>` element
    /// instead of the hardcoded defaults, preserving the original prefix assignments
    /// and declaration order.
    pub fn set_root_namespace_attrs(&mut self, attrs: Vec<(String, String)>) {
        self.root_namespace_attrs = attrs;
    }

    /// Add a picture with two-cell anchor
    pub fn add_picture(
        &mut self,
        from: CellAnchor,
        to: CellAnchor,
        image: ImageProps,
    ) -> &mut Self {
        let anchor = TwoCellAnchor {
            from,
            to,
            edit_as: None, // Omit editAs — OOXML default is "twoCell"
            client_data: ClientData::default(),
            mc_alternate_content: None,
        };
        self.anchors.push(DrawingAnchor::TwoCell(
            anchor,
            DrawingObject::Picture(image),
        ));
        self
    }

    /// Add a picture with fixed size (one-cell anchor)
    pub fn add_picture_fixed(
        &mut self,
        from: CellAnchor,
        width: i64,
        height: i64,
        image: ImageProps,
    ) -> &mut Self {
        let anchor = OneCellAnchor {
            from,
            extent: Extent {
                cx: width,
                cy: height,
            },
            client_data: ClientData::default(),
            mc_alternate_content: None,
        };
        self.anchors.push(DrawingAnchor::OneCell(
            anchor,
            DrawingObject::Picture(image),
        ));
        self
    }

    /// Add a shape with two-cell anchor
    pub fn add_shape(&mut self, from: CellAnchor, to: CellAnchor, shape: ShapeProps) -> &mut Self {
        let anchor = TwoCellAnchor {
            from,
            to,
            edit_as: None, // Omit editAs — OOXML default is "twoCell"
            client_data: ClientData::default(),
            mc_alternate_content: None,
        };
        self.anchors
            .push(DrawingAnchor::TwoCell(anchor, DrawingObject::Shape(shape)));
        self
    }

    /// Add a chart reference with two-cell anchor
    pub fn add_chart(&mut self, from: CellAnchor, to: CellAnchor, chart: ChartRef) -> &mut Self {
        let anchor = TwoCellAnchor {
            from,
            to,
            edit_as: None, // Omit editAs — OOXML default is "twoCell"
            client_data: ClientData::default(),
            mc_alternate_content: None,
        };
        self.anchors
            .push(DrawingAnchor::TwoCell(anchor, DrawingObject::Chart(chart)));
        self
    }

    /// Add a text box with two-cell anchor
    pub fn add_text_box(
        &mut self,
        from: CellAnchor,
        to: CellAnchor,
        text_box: TextBox,
    ) -> &mut Self {
        let anchor = TwoCellAnchor {
            from,
            to,
            edit_as: None, // Omit editAs — OOXML default is "twoCell"
            client_data: ClientData::default(),
            mc_alternate_content: None,
        };
        self.anchors.push(DrawingAnchor::TwoCell(
            anchor,
            DrawingObject::TextBox(text_box),
        ));
        self
    }

    /// Add a connector with two-cell anchor
    pub fn add_connector(
        &mut self,
        from: CellAnchor,
        to: CellAnchor,
        connector: ConnectorProps,
    ) -> &mut Self {
        let anchor = TwoCellAnchor {
            from,
            to,
            edit_as: None, // Omit editAs — OOXML default is "twoCell"
            client_data: ClientData::default(),
            mc_alternate_content: None,
        };
        self.anchors.push(DrawingAnchor::TwoCell(
            anchor,
            DrawingObject::Connector(connector),
        ));
        self
    }

    /// Add a custom drawing anchor
    pub fn add_anchor(&mut self, anchor: DrawingAnchor) -> &mut Self {
        self.anchors.push(anchor);
        self
    }

    /// Remap embedded relationship IDs after package graph resolution.
    pub fn remap_relationship_ids(&mut self, resolved_ids: &HashMap<String, String>) {
        self.registered_relationship_ids = resolved_ids.values().cloned().collect();
        for anchor in &mut self.anchors {
            let obj = match anchor {
                DrawingAnchor::TwoCell(_, obj)
                | DrawingAnchor::OneCell(_, obj)
                | DrawingAnchor::Absolute(_, obj) => obj,
            };
            Self::remap_object_relationship_ids(obj, resolved_ids);
        }
    }

    fn remap_object_relationship_ids(
        obj: &mut DrawingObject,
        resolved_ids: &HashMap<String, String>,
    ) {
        match obj {
            DrawingObject::Picture(image) => {
                if !image.r_id.is_empty() {
                    if let Some(resolved) = resolved_ids.get(&image.r_id) {
                        image.r_id = resolved.clone();
                    }
                }
                Self::remap_hyperlink_relationship_id(&mut image.hlink_click, resolved_ids);
                Self::remap_hyperlink_relationship_id(&mut image.hlink_hover, resolved_ids);
                if let Some(link_id) = &mut image.link_id {
                    if let Some(resolved) = resolved_ids.get(link_id) {
                        *link_id = resolved.clone();
                    }
                }
                image.blip_ext_lst = image
                    .blip_ext_lst
                    .as_ref()
                    .map(|raw| crate::infra::xml::remap_relationship_attrs(raw, resolved_ids));
                image.nv_ext_lst = image
                    .nv_ext_lst
                    .as_ref()
                    .map(|raw| crate::infra::xml::remap_relationship_attrs(raw, resolved_ids));
                image.sp_pr_ext_lst = image
                    .sp_pr_ext_lst
                    .as_ref()
                    .map(|raw| crate::infra::xml::remap_relationship_attrs(raw, resolved_ids));
            }
            DrawingObject::Chart(chart) => {
                Self::remap_hyperlink_relationship_id(&mut chart.hlink_click, resolved_ids);
                Self::remap_hyperlink_relationship_id(&mut chart.hlink_hover, resolved_ids);
                if let Some(resolved) = resolved_ids.get(&chart.r_id) {
                    chart.r_id = resolved.clone();
                }
            }
            DrawingObject::ChartEx(chart_ex) => {
                if let Some(resolved) = resolved_ids.get(&chart_ex.r_id) {
                    chart_ex.r_id = resolved.clone();
                }
            }
            DrawingObject::Slicer { r_id, .. } => {
                if let Some(resolved) = resolved_ids.get(r_id) {
                    *r_id = resolved.clone();
                }
            }
            DrawingObject::GraphicFrame(gf) => {
                gf.raw_xml = crate::infra::xml::remap_relationship_attrs(&gf.raw_xml, resolved_ids);
            }
            DrawingObject::OpaqueRaw(raw) => {
                raw.raw_xml =
                    crate::infra::xml::remap_relationship_attrs(&raw.raw_xml, resolved_ids);
            }
            DrawingObject::ContentPart(content_part) => {
                if let Some(resolved) = resolved_ids.get(&content_part.r_id) {
                    content_part.r_id = resolved.clone();
                }
            }
            DrawingObject::GroupShape(group) => {
                Self::remap_hyperlink_relationship_id(&mut group.hlink_click, resolved_ids);
                Self::remap_hyperlink_relationship_id(&mut group.hlink_hover, resolved_ids);
                group.nv_ext_lst = group
                    .nv_ext_lst
                    .as_ref()
                    .map(|raw| crate::infra::xml::remap_relationship_attrs(raw, resolved_ids));
                group.ext_lst = group
                    .ext_lst
                    .as_ref()
                    .map(|raw| crate::infra::xml::remap_relationship_attrs(raw, resolved_ids));
                for child in &mut group.children {
                    Self::remap_object_relationship_ids(child, resolved_ids);
                }
            }
            DrawingObject::TextBox(text_box) => {
                Self::remap_hyperlink_relationship_id(&mut text_box.hlink_click, resolved_ids);
                Self::remap_hyperlink_relationship_id(&mut text_box.hlink_hover, resolved_ids);
                if let Some(text_body) = &mut text_box.text_body {
                    Self::remap_text_body_hyperlink_relationship_ids(text_body, resolved_ids);
                }
            }
            DrawingObject::Connector(connector) => {
                Self::remap_hyperlink_relationship_id(&mut connector.hlink_click, resolved_ids);
                Self::remap_hyperlink_relationship_id(&mut connector.hlink_hover, resolved_ids);
            }
            _ => {}
        }
    }

    fn remap_hyperlink_relationship_id(
        hlink: &mut Option<ooxml_types::drawings::Hyperlink>,
        resolved_ids: &HashMap<String, String>,
    ) {
        let Some(hlink) = hlink else {
            return;
        };
        let Some(r_id) = &mut hlink.r_id else {
            return;
        };
        if let Some(resolved) = resolved_ids.get(r_id) {
            *r_id = resolved.clone();
        }
    }

    fn remap_text_body_hyperlink_relationship_ids(
        text_body: &mut ooxml_types::drawings::TextBody,
        resolved_ids: &HashMap<String, String>,
    ) {
        for paragraph in &mut text_body.paragraphs {
            if let Some(props) = paragraph.props.def_run_props.as_deref_mut() {
                Self::remap_run_property_hyperlink_relationship_ids(props, resolved_ids);
            }
            if let Some(props) = &mut paragraph.end_para_rpr {
                Self::remap_run_property_hyperlink_relationship_ids(props, resolved_ids);
            }
            for run in &mut paragraph.runs {
                match run {
                    ooxml_types::drawings::TextRunContent::Run(run) => {
                        Self::remap_run_property_hyperlink_relationship_ids(
                            &mut run.props,
                            resolved_ids,
                        );
                    }
                    ooxml_types::drawings::TextRunContent::LineBreak { props: Some(props) } => {
                        Self::remap_run_property_hyperlink_relationship_ids(props, resolved_ids);
                    }
                    ooxml_types::drawings::TextRunContent::Field {
                        run_props,
                        para_props,
                        ..
                    } => {
                        if let Some(props) = run_props {
                            Self::remap_run_property_hyperlink_relationship_ids(
                                props,
                                resolved_ids,
                            );
                        }
                        if let Some(para_props) = para_props {
                            if let Some(props) = para_props.def_run_props.as_deref_mut() {
                                Self::remap_run_property_hyperlink_relationship_ids(
                                    props,
                                    resolved_ids,
                                );
                            }
                        }
                    }
                    ooxml_types::drawings::TextRunContent::LineBreak { props: None } => {}
                }
            }
        }
    }

    fn remap_run_property_hyperlink_relationship_ids(
        props: &mut ooxml_types::drawings::RunProperties,
        resolved_ids: &HashMap<String, String>,
    ) {
        Self::remap_hyperlink_relationship_id(&mut props.hlink_click, resolved_ids);
        Self::remap_hyperlink_relationship_id(&mut props.hlink_mouse_over, resolved_ids);
    }

    /// Insert a drawing anchor at a specific position.
    /// If `index` is beyond the current length, appends to the end.
    pub fn insert_anchor(&mut self, index: usize, anchor: DrawingAnchor) -> &mut Self {
        let pos = index.min(self.anchors.len());
        self.anchors.insert(pos, anchor);
        self
    }

    /// Check if the drawing is empty
    pub fn is_empty(&self) -> bool {
        self.anchors.is_empty()
    }

    /// Get the number of drawing objects
    pub fn len(&self) -> usize {
        self.anchors.len()
    }

    /// Check if any anchor contains a slicer object.
    fn has_slicers(&self) -> bool {
        self.anchors.iter().any(|a| {
            let obj = match a {
                DrawingAnchor::TwoCell(_, o) => o,
                DrawingAnchor::OneCell(_, o) => o,
                DrawingAnchor::Absolute(_, o) => o,
            };
            matches!(obj, DrawingObject::Slicer { .. })
        })
    }

    /// Check if any anchor contains a timeline object.
    fn has_timelines(&self) -> bool {
        self.anchors.iter().any(|a| {
            let obj = match a {
                DrawingAnchor::TwoCell(_, o) => o,
                DrawingAnchor::OneCell(_, o) => o,
                DrawingAnchor::Absolute(_, o) => o,
            };
            matches!(obj, DrawingObject::Timeline { .. })
        })
    }

    /// Check if any anchor contains a ChartEx object.
    fn has_chart_ex(&self) -> bool {
        self.anchors.iter().any(|a| {
            let obj = match a {
                DrawingAnchor::TwoCell(_, o) => o,
                DrawingAnchor::OneCell(_, o) => o,
                DrawingAnchor::Absolute(_, o) => o,
            };
            matches!(obj, DrawingObject::ChartEx(_))
        })
    }

    /// Check if a drawing object uses `r:` prefixed attributes (r:embed, r:id, r:link).
    fn object_needs_r_namespace(obj: &DrawingObject) -> bool {
        match obj {
            // These always reference relationship IDs via r: attributes
            DrawingObject::Picture(_) => true,
            DrawingObject::Chart(_) => true,
            DrawingObject::ChartEx(_) => true,
            DrawingObject::SmartArt(_) => true,
            DrawingObject::GraphicFrame(_) => true,
            DrawingObject::OpaqueRaw(_) => true,
            DrawingObject::ContentPart(_) => true,
            // Group shapes need r: if any child does
            DrawingObject::GroupShape(g) => {
                Self::hyperlink_needs_r_namespace(&g.hlink_click)
                    || Self::hyperlink_needs_r_namespace(&g.hlink_hover)
                    || g.children.iter().any(Self::object_needs_r_namespace)
            }
            DrawingObject::TextBox(text_box) => {
                Self::hyperlink_needs_r_namespace(&text_box.hlink_click)
                    || Self::hyperlink_needs_r_namespace(&text_box.hlink_hover)
                    || text_box
                        .text_body
                        .as_ref()
                        .is_some_and(Self::text_body_needs_r_namespace)
            }
            DrawingObject::Connector(connector) => {
                Self::hyperlink_needs_r_namespace(&connector.hlink_click)
                    || Self::hyperlink_needs_r_namespace(&connector.hlink_hover)
            }
            // Shapes and Slicers don't inherently use r:
            _ => false,
        }
    }

    fn hyperlink_needs_r_namespace(hlink: &Option<ooxml_types::drawings::Hyperlink>) -> bool {
        hlink
            .as_ref()
            .and_then(|hlink| hlink.r_id.as_deref())
            .is_some_and(|r_id| Self::is_relationship_id_writable_static(r_id))
    }

    fn is_relationship_id_writable_static(r_id: &str) -> bool {
        !r_id.is_empty()
    }

    fn text_body_needs_r_namespace(text_body: &ooxml_types::drawings::TextBody) -> bool {
        text_body.paragraphs.iter().any(|paragraph| {
            paragraph
                .props
                .def_run_props
                .as_deref()
                .is_some_and(Self::run_properties_need_r_namespace)
                || paragraph
                    .end_para_rpr
                    .as_ref()
                    .is_some_and(Self::run_properties_need_r_namespace)
                || paragraph.runs.iter().any(|run| match run {
                    ooxml_types::drawings::TextRunContent::Run(run) => {
                        Self::run_properties_need_r_namespace(&run.props)
                    }
                    ooxml_types::drawings::TextRunContent::LineBreak { props } => props
                        .as_ref()
                        .is_some_and(Self::run_properties_need_r_namespace),
                    ooxml_types::drawings::TextRunContent::Field {
                        run_props,
                        para_props,
                        ..
                    } => {
                        run_props
                            .as_ref()
                            .is_some_and(Self::run_properties_need_r_namespace)
                            || para_props.as_ref().is_some_and(|para_props| {
                                para_props
                                    .def_run_props
                                    .as_deref()
                                    .is_some_and(Self::run_properties_need_r_namespace)
                            })
                    }
                })
        })
    }

    fn run_properties_need_r_namespace(props: &ooxml_types::drawings::RunProperties) -> bool {
        Self::hyperlink_needs_r_namespace(&props.hlink_click)
            || Self::hyperlink_needs_r_namespace(&props.hlink_mouse_over)
    }

    /// Check if any anchor in this drawing needs the `xmlns:r` namespace declaration.
    fn needs_r_namespace(&self) -> bool {
        self.anchors.iter().any(|a| {
            let obj = match a {
                DrawingAnchor::TwoCell(_, o) => o,
                DrawingAnchor::OneCell(_, o) => o,
                DrawingAnchor::Absolute(_, o) => o,
            };
            Self::object_needs_r_namespace(obj)
        })
    }

    /// Generate drawing XML
    pub fn to_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();
        w.write_declaration();

        let has_slicers = self.has_slicers();
        let has_timelines = self.has_timelines();
        let has_chart_ex = self.has_chart_ex();
        let needs_mc = has_slicers || has_timelines || has_chart_ex;

        // Start root element with namespaces.
        // If we have root namespace attrs from the original file, use those
        // to maintain round-trip fidelity (preserving prefixes and order).
        w.start_element("xdr:wsDr");

        if !self.root_namespace_attrs.is_empty() {
            // Emit root namespace declarations from the original file.
            for (attr_name, attr_value) in &self.root_namespace_attrs {
                w.attr(attr_name, attr_value);
            }
            // If the original declared xmlns:r inline (e.g. on <a:blip>) rather
            // than on the root element, we still need it on the root since our
            // writer doesn't emit inline namespace declarations.
            let has_r = self
                .root_namespace_attrs
                .iter()
                .any(|(k, _)| k == "xmlns:r");
            if !has_r && self.needs_r_namespace() {
                w.attr("xmlns:r", NS_R);
            }

            // If the original didn't have slicer namespaces but we need them,
            // add them (only if not already present).
            if has_slicers {
                let has_mc = self
                    .root_namespace_attrs
                    .iter()
                    .any(|(k, _)| k == "xmlns:mc");
                let has_a14 = self
                    .root_namespace_attrs
                    .iter()
                    .any(|(k, _)| k == "xmlns:a14");
                let has_sle = self
                    .root_namespace_attrs
                    .iter()
                    .any(|(k, _)| k == "xmlns:sle");
                if !has_mc {
                    w.attr("xmlns:mc", NS_MC);
                }
                if !has_a14 {
                    w.attr("xmlns:a14", NS_A14);
                }
                if !has_sle {
                    w.attr("xmlns:sle", NS_SLE);
                }
            }

            // ChartEx needs mc + cx namespaces
            if has_chart_ex {
                let has_mc = self
                    .root_namespace_attrs
                    .iter()
                    .any(|(k, _)| k == "xmlns:mc");
                let has_cx = self
                    .root_namespace_attrs
                    .iter()
                    .any(|(k, _)| k == "xmlns:cx");
                // mc may have been added above for slicers; only add if still missing
                if !has_mc && !has_slicers && !has_timelines {
                    w.attr("xmlns:mc", NS_MC);
                }
                if !has_cx {
                    w.attr("xmlns:cx", NS_CX);
                }
            }
        } else {
            // Fallback: hardcoded defaults for newly-created drawings.
            w.attr("xmlns:xdr", NS_XDR).attr("xmlns:a", NS_A);

            // Only declare xmlns:r when the drawing contains objects that
            // reference relationship IDs (pictures, charts, SmartArt, etc.).
            if self.needs_r_namespace() {
                w.attr("xmlns:r", NS_R);
            }

            if needs_mc {
                w.attr("xmlns:mc", NS_MC);
            }

            if has_slicers {
                w.attr("xmlns:a14", NS_A14).attr("xmlns:sle", NS_SLE);
            }

            if has_chart_ex {
                w.attr("xmlns:cx", NS_CX);
            }
        }

        w.end_attrs();

        // Write each anchor
        let mut object_id = 2u32;
        for anchor in &self.anchors {
            self.write_anchor(&mut w, anchor, &mut object_id);
        }

        w.end_element("xdr:wsDr");
        w.finish()
    }

    /// Write a drawing anchor
    fn write_anchor(&self, w: &mut XmlWriter, anchor: &DrawingAnchor, object_id: &mut u32) {
        match anchor {
            DrawingAnchor::TwoCell(two_cell, object) => {
                // If the anchor was wrapped in mc:AlternateContent, emit the raw XML
                // verbatim for perfect round-trip fidelity.
                if let Some(ref mc) = two_cell.mc_alternate_content
                    && self.write_raw_xml(w, &mc.raw_xml)
                {
                    return;
                }

                let el = w.start_element("xdr:twoCellAnchor");
                if let Some(ref ea) = two_cell.edit_as {
                    el.attr("editAs", ea.to_ooxml());
                }
                el.end_attrs();

                self.write_cell_anchor(w, "xdr:from", &two_cell.from);
                self.write_cell_anchor(w, "xdr:to", &two_cell.to);
                self.write_object(w, object, object_id);

                self.write_client_data(w, &two_cell.client_data);
                w.end_element("xdr:twoCellAnchor");
            }
            DrawingAnchor::OneCell(one_cell, object) => {
                // If the anchor was wrapped in mc:AlternateContent or contains
                // content-level mc:AlternateContent (slicer/timeslicer), emit raw XML
                // verbatim for perfect round-trip fidelity.
                if let Some(ref mc) = one_cell.mc_alternate_content
                    && self.write_raw_xml(w, &mc.raw_xml)
                {
                    return;
                }

                w.start_element("xdr:oneCellAnchor").end_attrs();

                self.write_cell_anchor(w, "xdr:from", &one_cell.from);
                self.write_extent(w, &one_cell.extent);
                self.write_object(w, object, object_id);

                self.write_client_data(w, &one_cell.client_data);
                w.end_element("xdr:oneCellAnchor");
            }
            DrawingAnchor::Absolute(absolute, object) => {
                w.start_element("xdr:absoluteAnchor").end_attrs();

                // Position
                w.start_element("xdr:pos")
                    .attr_num("x", absolute.pos.x)
                    .attr_num("y", absolute.pos.y)
                    .self_close();

                self.write_extent(w, &absolute.extent);
                self.write_object(w, object, object_id);

                self.write_client_data(w, &absolute.client_data);
                w.end_element("xdr:absoluteAnchor");
            }
        }
    }

    /// Write `<xdr:clientData>` element with optional lock/print attributes
    fn write_client_data(&self, w: &mut XmlWriter, cd: &ClientData) {
        w.start_element("xdr:clientData");
        if !cd.locks_with_sheet {
            w.attr("fLocksWithSheet", "0");
        }
        if !cd.prints_with_sheet {
            w.attr("fPrintsWithSheet", "0");
        }
        w.self_close();
    }

    /// Write a cell anchor (from/to)
    fn write_cell_anchor(&self, w: &mut XmlWriter, tag: &str, anchor: &CellAnchor) {
        w.start_element(tag).end_attrs();
        w.element_with_text("xdr:col", &anchor.col.to_string());
        w.element_with_text("xdr:colOff", &anchor.col_off.to_string());
        w.element_with_text("xdr:row", &anchor.row.to_string());
        w.element_with_text("xdr:rowOff", &anchor.row_off.to_string());
        w.end_element(tag);
    }

    /// Write extent element
    fn write_extent(&self, w: &mut XmlWriter, extent: &Extent) {
        w.start_element("xdr:ext")
            .attr_num("cx", extent.cx)
            .attr_num("cy", extent.cy)
            .self_close();
    }

    /// Write a drawing object
    fn write_object(&self, w: &mut XmlWriter, object: &DrawingObject, object_id: &mut u32) {
        match object {
            DrawingObject::Picture(image) => self.write_picture(w, image, object_id),
            DrawingObject::Shape(shape) => self.write_shape(w, shape, object_id),
            DrawingObject::Chart(chart) => self.write_chart(w, chart, object_id),
            DrawingObject::ChartEx(cx_ref) => self.write_chart_ex(w, cx_ref, object_id),
            DrawingObject::TextBox(text_box) => self.write_text_box(w, text_box, object_id),
            DrawingObject::Connector(props) => self.write_connector(w, props, object_id),
            DrawingObject::GroupShape(props) => self.write_group_shape(w, props, object_id),
            DrawingObject::GraphicFrame(gf) => self.write_graphic_frame(w, gf),
            DrawingObject::OpaqueRaw(raw) => {
                self.write_raw_xml(w, &raw.raw_xml);
            }
            DrawingObject::ContentPart(content_part) => {
                w.start_element("xdr:contentPart")
                    .attr("r:id", &content_part.r_id)
                    .self_close();
            }
            DrawingObject::SmartArt(sa) => self.write_smartart(w, sa, object_id),
            DrawingObject::Slicer {
                original_id,
                name,
                r_id,
                macro_name,
                nv_ext_lst,
            } => self.write_slicer(
                w,
                name,
                r_id,
                *original_id,
                macro_name.as_deref(),
                nv_ext_lst.as_deref(),
                object_id,
            ),
            DrawingObject::Timeline {
                original_id,
                name,
                macro_name,
                nv_ext_lst,
            } => self.write_timeline(
                w,
                name,
                *original_id,
                macro_name.as_deref(),
                nv_ext_lst.as_deref(),
                object_id,
            ),
        }
    }
}
