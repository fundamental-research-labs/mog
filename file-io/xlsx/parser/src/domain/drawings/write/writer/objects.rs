//! Object type writers for DrawingML XML generation.
//!
//! Each method serializes a specific drawing object type (picture, shape, chart,
//! text box, connector, group shape, graphic frame, SmartArt, slicer, ChartEx).

use crate::write::xml_writer::XmlWriter;

use super::super::types::{
    ChartExRef, ChartRef, ConnectorProps, DIAGRAM_GRAPHIC_DATA_URI, FillMode, GroupShapeProps,
    ImageProps, NS_C, NS_CX, NS_CX1, NS_DGM, NS_R, OpaqueGraphicFrame, SLICER_GRAPHIC_DATA_URI,
    ShapePreset, ShapeProps, SmartArtWriteData, TextBox,
};

use super::styling::{write_scene3d, write_shape3d};

use super::DrawingWriter;

fn write_raw_xml(w: &mut XmlWriter, raw_xml: &str, suppress_unregistered_relationships: bool) {
    if suppress_unregistered_relationships {
        DrawingWriter::write_raw_xml_if_relationship_safe(w, raw_xml);
    } else {
        w.raw_str(raw_xml);
    }
}

impl DrawingWriter {
    /// Write a picture element (`<xdr:pic>`) with full OOXML fidelity
    pub(super) fn write_picture(&self, w: &mut XmlWriter, image: &ImageProps, object_id: &mut u32) {
        let id = image.original_id.unwrap_or(*object_id);
        *object_id += 1;

        // <xdr:pic> with optional macro attribute
        w.start_element("xdr:pic");
        if let Some(ref macro_name) = image.macro_name {
            w.attr("macro", macro_name);
        }
        w.end_attrs();

        // ---- nvPicPr ----
        w.start_element("xdr:nvPicPr").end_attrs();
        {
            // cNvPr
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &image.name);
            if let Some(ref desc) = image.description {
                w.attr("descr", desc);
            }
            if let Some(ref title) = image.title {
                w.attr("title", title);
            }
            if image.hidden {
                w.attr("hidden", "1");
            }

            let has_children = image.hlink_click.is_some()
                || image.hlink_hover.is_some()
                || image.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();
                if let Some(ref hlink) = image.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = image.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = image.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // cNvPicPr
            let locks = &image.locks;
            let has_any_lock = locks.no_crop
                || locks.no_change_aspect
                || locks.no_grp
                || locks.no_select
                || locks.no_rot
                || locks.no_move
                || locks.no_resize
                || locks.no_edit_points
                || locks.no_adjust_handles
                || locks.no_change_arrowheads
                || locks.no_change_shape_type
                || locks.ext_lst.is_some();

            w.start_element("xdr:cNvPicPr");
            if let Some(false) = image.prefer_relative_resize {
                w.attr("preferRelativeResize", "0");
            }
            if has_any_lock || image.has_pic_locks {
                w.end_attrs();
                w.start_element("a:picLocks");
                if locks.no_crop {
                    w.attr("noCrop", "1");
                }
                if locks.no_change_aspect {
                    w.attr("noChangeAspect", "1");
                }
                if locks.no_grp {
                    w.attr("noGrp", "1");
                }
                if locks.no_select {
                    w.attr("noSelect", "1");
                }
                if locks.no_rot {
                    w.attr("noRot", "1");
                }
                if locks.no_move {
                    w.attr("noMove", "1");
                }
                if locks.no_resize {
                    w.attr("noResize", "1");
                }
                if locks.no_edit_points {
                    w.attr("noEditPoints", "1");
                }
                if locks.no_adjust_handles {
                    w.attr("noAdjustHandles", "1");
                }
                if locks.no_change_arrowheads {
                    w.attr("noChangeArrowheads", "1");
                }
                if locks.no_change_shape_type {
                    w.attr("noChangeShapeType", "1");
                }
                if let Some(ref ext) = locks.ext_lst {
                    w.end_attrs();
                    self.write_raw_xml(w, ext);
                    w.end_element("a:picLocks");
                } else {
                    w.self_close();
                }
                w.end_element("xdr:cNvPicPr");
            } else {
                w.self_close();
            }
        }
        w.end_element("xdr:nvPicPr");

        // ---- blipFill ----
        w.start_element("xdr:blipFill");
        if let Some(dpi) = image.dpi {
            w.attr_num("dpi", dpi);
        }
        if let Some(rot_ws) = image.rot_with_shape {
            w.attr("rotWithShape", if rot_ws { "1" } else { "0" });
        }
        w.end_attrs();
        {
            // <a:blip>
            let has_effects = !image.blip_effects.is_empty();
            let has_blip_ext = image.blip_ext_lst.is_some();
            w.start_element("a:blip").attr("r:embed", &image.r_id);
            if !self.suppress_unregistered_relationships {
                if let Some(ref link_id) = image.link_id {
                    w.attr("r:link", link_id);
                }
            }
            if let Some(ref comp) = image.compression {
                w.attr("cstate", comp.to_ooxml());
            }

            if has_effects || has_blip_ext {
                w.end_attrs();
                if has_effects {
                    self.write_blip_effects(w, &image.blip_effects);
                }
                if let Some(ref ext) = image.blip_ext_lst {
                    self.write_raw_xml(w, ext);
                }
                w.end_element("a:blip");
            } else {
                w.self_close();
            }

            // <a:srcRect> — only emit attributes that were explicitly present in the
            // original XML *or* have non-zero values. This avoids adding default zeros
            // for absent attributes (e.g. `<a:srcRect/>` stays empty, not `l="0" t="0" ...`).
            if let Some(ref rect) = image.source_rect {
                let e = image.src_rect_explicit;
                w.start_element("a:srcRect");
                if e & 1 != 0 || rect.left.value() != 0 {
                    w.attr_num("l", rect.left);
                }
                if e & 2 != 0 || rect.top.value() != 0 {
                    w.attr_num("t", rect.top);
                }
                if e & 4 != 0 || rect.right.value() != 0 {
                    w.attr_num("r", rect.right);
                }
                if e & 8 != 0 || rect.bottom.value() != 0 {
                    w.attr_num("b", rect.bottom);
                }
                w.self_close();
            }

            // Fill mode
            match &image.fill_mode {
                Some(FillMode::Tile(tile)) => {
                    w.start_element("a:tile");
                    if let Some(tx) = tile.tx {
                        w.attr_num("tx", tx);
                    }
                    if let Some(ty) = tile.ty {
                        w.attr_num("ty", ty);
                    }
                    if let Some(sx) = tile.sx {
                        w.attr_num("sx", sx);
                    }
                    if let Some(sy) = tile.sy {
                        w.attr_num("sy", sy);
                    }
                    w.attr("flip", tile.flip.to_ooxml());
                    if let Some(ref align) = tile.align {
                        w.attr("algn", align.to_ooxml());
                    }
                    w.self_close();
                }
                Some(FillMode::Stretch { fill_rect }) => {
                    if let Some(fr) = fill_rect {
                        w.start_element("a:stretch").end_attrs();
                        if fr.top.value() != 0
                            || fr.bottom.value() != 0
                            || fr.left.value() != 0
                            || fr.right.value() != 0
                        {
                            w.start_element("a:fillRect");
                            if fr.top.value() != 0 {
                                w.attr_num("t", fr.top);
                            }
                            if fr.bottom.value() != 0 {
                                w.attr_num("b", fr.bottom);
                            }
                            if fr.left.value() != 0 {
                                w.attr_num("l", fr.left);
                            }
                            if fr.right.value() != 0 {
                                w.attr_num("r", fr.right);
                            }
                            w.self_close();
                        } else {
                            w.start_element("a:fillRect").self_close();
                        }
                        w.end_element("a:stretch");
                    } else {
                        // <a:stretch/> with no fillRect child
                        w.start_element("a:stretch").self_close();
                    }
                }
                None => {
                    // No fill mode in parsed data — don't emit one
                }
            }
        }
        w.end_element("xdr:blipFill");

        // ---- spPr ----
        w.start_element("xdr:spPr");
        if let Some(ref bw) = image.bw_mode {
            w.attr("bwMode", bw.to_ooxml());
        }
        w.end_attrs();
        {
            // Transform
            w.start_element("a:xfrm");
            if let Some(rot) = image.rotation {
                w.attr_num("rot", rot);
            }
            if image.flip_h {
                w.attr("flipH", "1");
            }
            if image.flip_v {
                w.attr("flipV", "1");
            }
            w.end_attrs();
            w.start_element("a:off")
                .attr_num("x", image.offset_x)
                .attr_num("y", image.offset_y)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", image.extent_cx)
                .attr_num("cy", image.extent_cy)
                .self_close();
            w.end_element("a:xfrm");

            // Preset geometry
            let (prst, av_list) = match image.preset_geometry.as_ref() {
                Some(pg) => (pg.prst.to_ooxml(), pg.av_list.as_slice()),
                None => (ShapePreset::Rect.to_ooxml(), &[][..]),
            };
            w.start_element("a:prstGeom").attr("prst", prst).end_attrs();
            Self::write_av_list(w, av_list);
            w.end_element("a:prstGeom");

            // Fill (from ooxml DrawingFill)
            if let Some(ref fill) = image.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = image.outline {
                self.write_ooxml_outline(w, outline);
            }

            // Effect properties
            if let Some(ref ep) = image.effects {
                self.write_effect_properties(w, ep);
            }

            // Scene3D (typed)
            if let Some(ref scene) = image.scene3d {
                write_scene3d(w, scene);
            }

            // Shape3D (typed)
            if let Some(ref sp3d) = image.sp3d {
                write_shape3d(w, sp3d);
            }
            // Extension list on spPr (opaque passthrough)
            if let Some(ref ext) = image.sp_pr_ext_lst {
                self.write_raw_xml(w, ext);
            }
        }
        w.end_element("xdr:spPr");

        // ---- style ----
        if let Some(ref style) = image.style {
            self.write_shape_style(w, style);
        }

        w.end_element("xdr:pic");
    }

    /// Write a shape element
    pub(super) fn write_shape(&self, w: &mut XmlWriter, shape: &ShapeProps, object_id: &mut u32) {
        let id = shape.original_id.unwrap_or(*object_id);
        *object_id += 1;

        let el = w.start_element("xdr:sp");
        if let Some(ref m) = shape.macro_name {
            el.attr("macro", m);
        }
        if let Some(ref tl) = shape.textlink {
            el.attr("textlink", tl);
        }
        el.end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvSpPr").end_attrs();
        {
            let cnv = w
                .start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &shape.name);
            if let Some(ref ext) = shape.nv_ext_lst {
                cnv.end_attrs();
                self.write_raw_xml(w, ext);
                w.end_element("xdr:cNvPr");
            } else {
                cnv.self_close();
            }

            {
                let cnv_sp = w.start_element("xdr:cNvSpPr");
                if shape.tx_box {
                    cnv_sp.attr_bool("txBox", true);
                }
                cnv_sp.self_close();
            }
        }
        w.end_element("xdr:nvSpPr");

        // Shape properties
        w.start_element("xdr:spPr").end_attrs();
        {
            // Transform
            if let Some(ref xfrm) = shape.xfrm {
                w.start_element("a:xfrm");
                if xfrm.rot().value() != 0 {
                    w.attr_num("rot", xfrm.rot().value());
                }
                if xfrm.is_flip_h() {
                    w.attr("flipH", "1");
                }
                if xfrm.is_flip_v() {
                    w.attr("flipV", "1");
                }
                w.end_attrs();
                w.start_element("a:off")
                    .attr_num("x", xfrm.off_x())
                    .attr_num("y", xfrm.off_y())
                    .self_close();
                w.start_element("a:ext")
                    .attr_num("cx", xfrm.ext_cx())
                    .attr_num("cy", xfrm.ext_cy())
                    .self_close();
                w.end_element("a:xfrm");
            }

            // Preset geometry
            w.start_element("a:prstGeom")
                .attr("prst", shape.preset.to_ooxml())
                .end_attrs();
            w.start_element("a:avLst").self_close();
            w.end_element("a:prstGeom");

            // Fill
            if let Some(ref fill) = shape.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = shape.outline {
                self.write_ooxml_outline(w, outline);
            }
        }
        w.end_element("xdr:spPr");

        // Style
        if let Some(ref style) = shape.style {
            self.write_shape_style(w, style);
        }

        // Text body if present
        if let Some(ref text) = shape.text {
            self.write_text_body(w, text, true, None);
        }

        w.end_element("xdr:sp");
    }

    /// Write a chart reference
    pub(super) fn write_chart(&self, w: &mut XmlWriter, chart: &ChartRef, object_id: &mut u32) {
        let id = chart.original_id.unwrap_or(*object_id);
        *object_id += 1;

        {
            let el = w.start_element("xdr:graphicFrame");
            // Only emit macro="" when the original had it (Some("") preserves it).
            if let Some(ref m) = chart.macro_name {
                el.attr("macro", m);
            }
            el.end_attrs();
        }

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &chart.name);
            if let Some(ref descr) = chart.descr {
                w.attr("descr", descr);
            }
            if let Some(ref title) = chart.title {
                w.attr("title", title);
            }
            if chart.hidden {
                w.attr("hidden", "1");
            }

            let has_children = chart.hlink_click.is_some()
                || chart.hlink_hover.is_some()
                || chart.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();
                if let Some(ref hlink) = chart.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = chart.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = chart.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }
            Self::write_cnv_graphic_frame_pr(
                w,
                &chart.graphic_frame_locks,
                chart.has_graphic_frame_locks,
                chart.no_change_aspect_explicit,
                chart.no_drilldown,
                &chart.c_nv_graphic_frame_pr_ext_lst,
                self.suppress_unregistered_relationships,
            );
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform — preserve original values for round-trip fidelity
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", chart.xfrm_off_x)
                .attr_num("y", chart.xfrm_off_y)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", chart.xfrm_ext_cx)
                .attr_num("cy", chart.xfrm_ext_cy)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with chart reference
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", NS_C)
                .end_attrs();
            {
                w.start_element("c:chart")
                    .attr("xmlns:c", NS_C)
                    .attr("r:id", &chart.r_id)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
    }

    /// Write `<xdr:cNvGraphicFramePr>` with optional `<a:graphicFrameLocks>` child.
    ///
    /// When `has_locks_element` is true, emits `<a:graphicFrameLocks/>` even if all
    /// attributes are default/false (round-trip fidelity for Excel-generated files).
    /// `no_change_aspect_explicit` preserves explicit `noChangeAspect="0"` from the original.
    pub(super) fn write_cnv_graphic_frame_pr(
        w: &mut XmlWriter,
        locks: &ooxml_types::drawings::DrawingLocking,
        has_locks_element: bool,
        no_change_aspect_explicit: Option<bool>,
        no_drilldown: bool,
        ext_lst: &Option<String>,
        suppress_unregistered_relationships: bool,
    ) {
        let has_lock_attrs = locks.no_grp
            || locks.no_select
            || locks.no_change_aspect
            || locks.no_move
            || locks.no_resize
            || no_drilldown
            || no_change_aspect_explicit.is_some()
            || locks.ext_lst.is_some();
        // Emit the element if any attributes are set OR if the element was present
        // in the original XML (even with no attributes, e.g. `<a:graphicFrameLocks/>`).
        let emit_locks = has_lock_attrs || has_locks_element;
        let has_children = emit_locks || ext_lst.is_some();

        if !has_children {
            w.start_element("xdr:cNvGraphicFramePr").self_close();
            return;
        }

        w.start_element("xdr:cNvGraphicFramePr").end_attrs();

        if emit_locks {
            w.start_element("a:graphicFrameLocks");
            if locks.no_grp {
                w.attr("noGrp", "1");
            }
            if no_drilldown {
                w.attr("noDrilldown", "1");
            }
            if locks.no_select {
                w.attr("noSelect", "1");
            }
            // Use explicit Option<bool> for noChangeAspect to preserve "0" values
            match no_change_aspect_explicit {
                Some(true) => {
                    w.attr("noChangeAspect", "1");
                }
                Some(false) => {
                    w.attr("noChangeAspect", "0");
                }
                None => {
                    // Fall back to the bool from DrawingLocking
                    if locks.no_change_aspect {
                        w.attr("noChangeAspect", "1");
                    }
                }
            }
            if locks.no_move {
                w.attr("noMove", "1");
            }
            if locks.no_resize {
                w.attr("noResize", "1");
            }
            if let Some(ref lock_ext) = locks.ext_lst {
                w.end_attrs();
                write_raw_xml(w, lock_ext, suppress_unregistered_relationships);
                w.end_element("a:graphicFrameLocks");
            } else {
                w.self_close();
            }
        }

        if let Some(ext) = ext_lst {
            write_raw_xml(w, ext, suppress_unregistered_relationships);
        }

        w.end_element("xdr:cNvGraphicFramePr");
    }

    /// Write a text box / shape element (`<xdr:sp>`)
    pub(super) fn write_text_box(
        &self,
        w: &mut XmlWriter,
        text_box: &TextBox,
        object_id: &mut u32,
    ) {
        let id = text_box.original_id.unwrap_or(*object_id);
        *object_id += 1;

        let el = w.start_element("xdr:sp");
        if let Some(ref m) = text_box.macro_name {
            el.attr("macro", m);
        }
        if let Some(ref tl) = text_box.textlink {
            el.attr("textlink", tl);
        }
        if let Some(true) = text_box.f_locks_text {
            el.attr("fLocksText", "1");
        } else if let Some(false) = text_box.f_locks_text {
            el.attr("fLocksText", "0");
        }
        if let Some(true) = text_box.f_published {
            el.attr("fPublished", "1");
        }
        el.end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvSpPr").end_attrs();
        {
            // cNvPr
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &text_box.name);
            if let Some(ref desc) = text_box.description {
                w.attr("descr", desc);
            }
            if let Some(ref title) = text_box.title {
                w.attr("title", title);
            }
            if text_box.hidden {
                w.attr("hidden", "1");
            }

            let has_children = text_box.hlink_click.is_some()
                || text_box.hlink_hover.is_some()
                || text_box.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();
                if let Some(ref hlink) = text_box.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = text_box.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = text_box.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // cNvSpPr
            let locks = &text_box.c_nv_sp_pr;
            let has_locks = locks.no_grp
                || locks.no_select
                || locks.no_rot
                || locks.no_change_aspect
                || locks.no_move
                || locks.no_resize
                || locks.no_edit_points
                || locks.no_adjust_handles
                || locks.no_change_arrowheads
                || locks.no_change_shape_type
                || locks.no_text_edit
                || locks.ext_lst.is_some();
            let has_ext = text_box.c_nv_sp_pr_ext_lst.is_some();

            w.start_element("xdr:cNvSpPr");
            if text_box.tx_box {
                w.attr_bool("txBox", true);
            }
            if has_locks || text_box.has_sp_locks || has_ext {
                w.end_attrs();
                if has_locks || text_box.has_sp_locks {
                    w.start_element("a:spLocks");
                    if locks.no_grp {
                        w.attr("noGrp", "1");
                    }
                    if locks.no_select {
                        w.attr("noSelect", "1");
                    }
                    if locks.no_rot {
                        w.attr("noRot", "1");
                    }
                    // Use explicit Option<bool> for noChangeAspect to preserve "0" values
                    match text_box.no_change_aspect_explicit {
                        Some(true) => {
                            w.attr("noChangeAspect", "1");
                        }
                        Some(false) => {
                            w.attr("noChangeAspect", "0");
                        }
                        None => {
                            if locks.no_change_aspect {
                                w.attr("noChangeAspect", "1");
                            }
                        }
                    }
                    if locks.no_move {
                        w.attr("noMove", "1");
                    }
                    if locks.no_resize {
                        w.attr("noResize", "1");
                    }
                    if locks.no_edit_points {
                        w.attr("noEditPoints", "1");
                    }
                    if locks.no_adjust_handles {
                        w.attr("noAdjustHandles", "1");
                    }
                    if locks.no_change_arrowheads {
                        w.attr("noChangeArrowheads", "1");
                    }
                    if locks.no_change_shape_type {
                        w.attr("noChangeShapeType", "1");
                    }
                    if locks.no_text_edit {
                        w.attr("noTextEdit", "1");
                    }
                    if let Some(ref ext) = locks.ext_lst {
                        w.end_attrs();
                        self.write_raw_xml(w, ext);
                        w.end_element("a:spLocks");
                    } else {
                        w.self_close();
                    }
                }
                if let Some(ref ext) = text_box.c_nv_sp_pr_ext_lst {
                    self.write_raw_xml(w, ext);
                }
                w.end_element("xdr:cNvSpPr");
            } else {
                w.self_close();
            }
        }
        w.end_element("xdr:nvSpPr");

        // Shape properties
        w.start_element("xdr:spPr");
        if let Some(ref bw) = text_box.bw_mode {
            w.attr("bwMode", bw.to_ooxml());
        }
        w.end_attrs();
        {
            // Transform
            if let Some(ref xfrm) = text_box.xfrm {
                w.start_element("a:xfrm");
                if xfrm.rot().value() != 0 {
                    w.attr_num("rot", xfrm.rot().value());
                }
                if xfrm.is_flip_h() {
                    w.attr("flipH", "1");
                }
                if xfrm.is_flip_v() {
                    w.attr("flipV", "1");
                }
                w.end_attrs();
                w.start_element("a:off")
                    .attr_num("x", xfrm.off_x())
                    .attr_num("y", xfrm.off_y())
                    .self_close();
                w.start_element("a:ext")
                    .attr_num("cx", xfrm.ext_cx())
                    .attr_num("cy", xfrm.ext_cy())
                    .self_close();
                w.end_element("a:xfrm");
            }

            // Preset geometry
            let (prst, av_list) = match text_box.preset_geometry.as_ref() {
                Some(pg) => (pg.prst, pg.av_list.as_slice()),
                None => (ShapePreset::Rect, &[][..]),
            };
            w.start_element("a:prstGeom")
                .attr("prst", prst.to_ooxml())
                .end_attrs();
            Self::write_av_list(w, av_list);
            w.end_element("a:prstGeom");

            // Fill
            if let Some(ref fill) = text_box.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = text_box.outline {
                self.write_ooxml_outline(w, outline);
            }

            // Effects
            if let Some(ref ep) = text_box.effects {
                self.write_effect_properties(w, ep);
            }

            // Scene3D
            if let Some(ref scene) = text_box.scene3d {
                write_scene3d(w, scene);
            }

            // Shape3D
            if let Some(ref sp3d) = text_box.sp3d {
                write_shape3d(w, sp3d);
            }

            // Extension list on spPr
            if let Some(ref ext) = text_box.sp_pr_ext_lst {
                self.write_raw_xml(w, ext);
            }
        }
        w.end_element("xdr:spPr");

        // Style
        if let Some(ref style) = text_box.style {
            self.write_shape_style(w, style);
        }

        // Text body - imported shapes may intentionally omit txBody. Generated
        // API text boxes use TextBox::from_plain, which supplies a minimal body.
        if let Some(ref tb) = text_box.text_body {
            self.write_text_body_full(w, tb);
        }

        w.end_element("xdr:sp");
    }

    /// Write a connector element (`<xdr:cxnSp>`)
    pub(super) fn write_connector(
        &self,
        w: &mut XmlWriter,
        props: &ConnectorProps,
        object_id: &mut u32,
    ) {
        let id = props.original_id.unwrap_or(*object_id);
        *object_id += 1;

        // <xdr:cxnSp> with optional macro attribute
        w.start_element("xdr:cxnSp");
        if let Some(ref macro_name) = props.macro_name {
            w.attr("macro", macro_name);
        }
        w.end_attrs();

        // ---- Non-visual properties ----
        w.start_element("xdr:nvCxnSpPr").end_attrs();
        {
            // <xdr:cNvPr>
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &props.name);
            if let Some(ref desc) = props.description {
                w.attr("descr", desc);
            }
            if let Some(ref title) = props.title {
                w.attr("title", title);
            }
            if props.hidden {
                w.attr("hidden", "1");
            }

            // Check if we need child elements (hyperlinks, extLst)
            let has_children = props.hlink_click.is_some()
                || props.hlink_hover.is_some()
                || props.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();

                // <a:hlinkClick>
                if let Some(ref hlink) = props.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                // <a:hlinkHover>
                if let Some(ref hlink) = props.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = props.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }

                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // <xdr:cNvCxnSpPr>
            let locks = &props.locks;
            let has_locks = locks.no_grp
                || locks.no_select
                || locks.no_rot
                || locks.no_change_aspect
                || locks.no_move
                || locks.no_resize
                || locks.no_edit_points
                || locks.no_adjust_handles
                || locks.no_change_arrowheads
                || locks.no_change_shape_type
                || locks.ext_lst.is_some();
            let has_cxn_children =
                props.start_connection.is_some() || props.end_connection.is_some() || has_locks;
            if has_cxn_children {
                w.start_element("xdr:cNvCxnSpPr").end_attrs();

                // <a:cxnSpLocks> — only emit true values
                if has_locks {
                    w.start_element("a:cxnSpLocks");
                    if props.locks.no_grp {
                        w.attr_bool_if_true("noGrp", true);
                    }
                    if props.locks.no_select {
                        w.attr_bool_if_true("noSelect", true);
                    }
                    if props.locks.no_rot {
                        w.attr_bool_if_true("noRot", true);
                    }
                    if props.locks.no_change_aspect {
                        w.attr_bool_if_true("noChangeAspect", true);
                    }
                    if props.locks.no_move {
                        w.attr_bool_if_true("noMove", true);
                    }
                    if props.locks.no_resize {
                        w.attr_bool_if_true("noResize", true);
                    }
                    if props.locks.no_edit_points {
                        w.attr_bool_if_true("noEditPoints", true);
                    }
                    if props.locks.no_adjust_handles {
                        w.attr_bool_if_true("noAdjustHandles", true);
                    }
                    if props.locks.no_change_arrowheads {
                        w.attr_bool_if_true("noChangeArrowheads", true);
                    }
                    if props.locks.no_change_shape_type {
                        w.attr_bool_if_true("noChangeShapeType", true);
                    }
                    if let Some(ref ext) = props.locks.ext_lst {
                        w.end_attrs();
                        self.write_raw_xml(w, ext);
                        w.end_element("a:cxnSpLocks");
                    } else {
                        w.self_close();
                    }
                }

                // <a:stCxn>
                if let Some(ref cxn) = props.start_connection {
                    w.start_element("a:stCxn")
                        .attr_num("id", cxn.shape_id)
                        .attr_num("idx", cxn.idx)
                        .self_close();
                }

                // <a:endCxn>
                if let Some(ref cxn) = props.end_connection {
                    w.start_element("a:endCxn")
                        .attr_num("id", cxn.shape_id)
                        .attr_num("idx", cxn.idx)
                        .self_close();
                }

                w.end_element("xdr:cNvCxnSpPr");
            } else {
                w.start_element("xdr:cNvCxnSpPr").self_close();
            }
        }
        w.end_element("xdr:nvCxnSpPr");

        // ---- Shape properties ----
        w.start_element("xdr:spPr").end_attrs();
        {
            // Transform
            w.start_element("a:xfrm");
            if let Some(rot) = props.transform.rotation {
                w.attr_num("rot", rot);
            }
            if props.transform.is_flip_h() {
                w.attr_bool_if_true("flipH", true);
            }
            if props.transform.is_flip_v() {
                w.attr_bool_if_true("flipV", true);
            }
            w.end_attrs();
            {
                w.start_element("a:off")
                    .attr_num("x", props.transform.off_x())
                    .attr_num("y", props.transform.off_y())
                    .self_close();
                w.start_element("a:ext")
                    .attr_num("cx", props.transform.ext_cx())
                    .attr_num("cy", props.transform.ext_cy())
                    .self_close();
            }
            w.end_element("a:xfrm");

            // Preset geometry
            if let Some(ref pg) = props.preset_geometry {
                w.start_element("a:prstGeom")
                    .attr("prst", pg.prst.to_ooxml())
                    .end_attrs();
                Self::write_av_list(w, &pg.av_list);
                w.end_element("a:prstGeom");
            }

            // Fill
            if let Some(ref fill) = props.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = props.outline {
                self.write_ooxml_outline(w, outline);
            }
        }
        w.end_element("xdr:spPr");

        // ---- Style ----
        if let Some(ref style) = props.style {
            self.write_shape_style(w, style);
        }

        w.end_element("xdr:cxnSp");
    }

    /// Write a group shape element (`<xdr:grpSp>`)
    pub(super) fn write_group_shape(
        &self,
        w: &mut XmlWriter,
        props: &GroupShapeProps,
        object_id: &mut u32,
    ) {
        let id = props.original_id.unwrap_or(*object_id);
        *object_id += 1;

        // <xdr:grpSp>
        w.start_element("xdr:grpSp").end_attrs();

        // ---- nvGrpSpPr ----
        w.start_element("xdr:nvGrpSpPr").end_attrs();
        {
            // <xdr:cNvPr> — same pattern as write_connector
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &props.name);
            if let Some(ref desc) = props.description {
                w.attr("descr", desc);
            }
            if let Some(ref title) = props.title {
                w.attr("title", title);
            }
            if props.hidden {
                w.attr("hidden", "1");
            }

            let has_hlinks = props.hlink_click.is_some() || props.hlink_hover.is_some();
            if has_hlinks {
                w.end_attrs();
                if let Some(ref hlink) = props.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = props.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // <xdr:cNvGrpSpPr>
            let has_locks = props.group_locking.as_ref().is_some_and(|l| l.has_any());
            let has_nv_ext = props.nv_ext_lst.is_some();
            if has_locks || has_nv_ext {
                w.start_element("xdr:cNvGrpSpPr").end_attrs();

                // <a:grpSpLocks>
                if let Some(ref locks) = props.group_locking {
                    if locks.has_any() {
                        w.start_element("a:grpSpLocks");
                        if locks.no_grp {
                            w.attr("noGrp", "1");
                        }
                        if locks.no_ungrp {
                            w.attr("noUngrp", "1");
                        }
                        if locks.no_select {
                            w.attr("noSelect", "1");
                        }
                        if locks.no_rot {
                            w.attr("noRot", "1");
                        }
                        if locks.no_change_aspect {
                            w.attr("noChangeAspect", "1");
                        }
                        if locks.no_move {
                            w.attr("noMove", "1");
                        }
                        if locks.no_resize {
                            w.attr("noResize", "1");
                        }
                        if let Some(ref ext) = locks.ext_lst {
                            w.end_attrs();
                            self.write_raw_xml(w, ext);
                            w.end_element("a:grpSpLocks");
                        } else {
                            w.self_close();
                        }
                    }
                }

                // opaque cNvGrpSpPr extLst
                if let Some(ref ext) = props.nv_ext_lst {
                    self.write_raw_xml(w, ext);
                }

                w.end_element("xdr:cNvGrpSpPr");
            } else {
                w.start_element("xdr:cNvGrpSpPr").self_close();
            }
        }
        w.end_element("xdr:nvGrpSpPr");

        // ---- grpSpPr ----
        w.start_element("xdr:grpSpPr");
        if let Some(ref bw) = props.bw_mode {
            w.attr("bwMode", bw.to_ooxml());
        }
        w.end_attrs();
        {
            // Group transform (CT_GroupTransform2D)
            if let Some(ref xfrm) = props.transform {
                w.start_element("a:xfrm");
                if let Some(rot) = xfrm.rotation {
                    w.attr_num("rot", rot);
                }
                if let Some(true) = xfrm.flip_h {
                    w.attr("flipH", "1");
                }
                if let Some(true) = xfrm.flip_v {
                    w.attr("flipV", "1");
                }
                w.end_attrs();

                if let Some((x, y)) = xfrm.offset {
                    w.start_element("a:off")
                        .attr_num("x", x)
                        .attr_num("y", y)
                        .self_close();
                }
                if let Some((cx, cy)) = xfrm.extent {
                    w.start_element("a:ext")
                        .attr_num("cx", cx)
                        .attr_num("cy", cy)
                        .self_close();
                }
                if let Some((x, y)) = xfrm.child_offset {
                    w.start_element("a:chOff")
                        .attr_num("x", x)
                        .attr_num("y", y)
                        .self_close();
                }
                if let Some((cx, cy)) = xfrm.child_extent {
                    w.start_element("a:chExt")
                        .attr_num("cx", cx)
                        .attr_num("cy", cy)
                        .self_close();
                }

                w.end_element("a:xfrm");
            }

            // Typed fill (same writer as shapes/pictures)
            if let Some(ref fill) = props.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Typed effect properties (same writer as shapes/pictures)
            if let Some(ref ep) = props.effects {
                self.write_effect_properties(w, ep);
            }

            // Scene3D (typed)
            if let Some(ref scene) = props.scene3d {
                write_scene3d(w, scene);
            }

            // Opaque extLst
            if let Some(ref ext) = props.ext_lst {
                self.write_raw_xml(w, ext);
            }
        }
        w.end_element("xdr:grpSpPr");

        // ---- Children ----
        for child in &props.children {
            self.write_object(w, child, object_id);
        }

        w.end_element("xdr:grpSp");
    }

    /// Write an opaque graphic frame verbatim
    pub(super) fn write_graphic_frame(&self, w: &mut XmlWriter, gf: &OpaqueGraphicFrame) {
        self.write_raw_xml(w, &gf.raw_xml);
    }

    /// Write a SmartArt graphicFrame element (`<xdr:graphicFrame>`) with `<dgm:relIds>`.
    pub(super) fn write_smartart(
        &self,
        w: &mut XmlWriter,
        sa: &SmartArtWriteData,
        object_id: &mut u32,
    ) {
        let id = sa.original_id.unwrap_or(*object_id);
        *object_id += 1;

        w.start_element("xdr:graphicFrame").end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &sa.name)
                .self_close();
            w.start_element("xdr:cNvGraphicFramePr").self_close();
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform (zeroed — position comes from the anchor)
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", 0)
                .attr_num("y", 0)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", 0)
                .attr_num("cy", 0)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with diagram relIds
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", DIAGRAM_GRAPHIC_DATA_URI)
                .end_attrs();
            if !self.suppress_unregistered_relationships {
                w.start_element("dgm:relIds")
                    .attr("xmlns:dgm", NS_DGM)
                    .attr("r:dm", &sa.dm_rel_id)
                    .attr("r:lo", &sa.lo_rel_id)
                    .attr("r:qs", &sa.qs_rel_id)
                    .attr("r:cs", &sa.cs_rel_id)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
    }

    /// Write a slicer as `mc:AlternateContent` with `mc:Choice Requires="a14"`.
    ///
    /// Produces:
    /// ```xml
    /// <mc:AlternateContent>
    ///   <mc:Choice Requires="a14">
    ///     <xdr:graphicFrame>
    ///       <xdr:nvGraphicFramePr>
    ///         <xdr:cNvPr id="N" name="SlicerName"/>
    ///         <xdr:cNvGraphicFramePr/>
    ///       </xdr:nvGraphicFramePr>
    ///       <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    ///       <a:graphic>
    ///         <a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer">
    ///           <sle:slicer name="SlicerName"/>
    ///         </a:graphicData>
    ///       </a:graphic>
    ///     </xdr:graphicFrame>
    ///   </mc:Choice>
    ///   <mc:Fallback/>
    /// </mc:AlternateContent>
    /// ```
    pub(super) fn write_slicer(
        &self,
        w: &mut XmlWriter,
        name: &str,
        _r_id: &str,
        original_id: Option<u32>,
        object_id: &mut u32,
    ) {
        let id = original_id.unwrap_or(*object_id);
        *object_id += 1;

        w.start_element("mc:AlternateContent").end_attrs();

        // mc:Choice with a14 requirement
        w.start_element("mc:Choice")
            .attr("Requires", "a14")
            .end_attrs();

        // graphicFrame
        w.start_element("xdr:graphicFrame").end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", name)
                .self_close();
            w.start_element("xdr:cNvGraphicFramePr").self_close();
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform (zeroed — position comes from the anchor)
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", 0)
                .attr_num("y", 0)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", 0)
                .attr_num("cy", 0)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with slicer reference
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", SLICER_GRAPHIC_DATA_URI)
                .end_attrs();
            {
                w.start_element("sle:slicer")
                    .attr("name", name)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
        w.end_element("mc:Choice");

        // Fallback (empty — non-a14 consumers see nothing)
        w.start_element("mc:Fallback").self_close();

        w.end_element("mc:AlternateContent");
    }

    /// Write a ChartEx anchor as `mc:AlternateContent` with `cx:chart` graphicFrame.
    ///
    /// Modern chart types (waterfall, treemap, sunburst, funnel, etc.) use the
    /// ChartEx format which requires mc:AlternateContent wrapping so that older
    /// Excel versions see a placeholder shape instead of crashing.
    pub(super) fn write_chart_ex(
        &self,
        w: &mut XmlWriter,
        cx_ref: &ChartExRef,
        object_id: &mut u32,
    ) {
        let _id = cx_ref.id;
        *object_id += 1;

        // mc:AlternateContent wrapper
        w.start_element("mc:AlternateContent").end_attrs();

        // mc:Choice — requires cx1 namespace for ChartEx
        w.start_element("mc:Choice")
            .attr("xmlns:cx1", NS_CX1)
            .attr("Requires", "cx1")
            .end_attrs();

        // graphicFrame
        {
            let el = w.start_element("xdr:graphicFrame");
            if let Some(ref m) = cx_ref.macro_name {
                el.attr("macro", m);
            }
            el.end_attrs();
        }

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", cx_ref.id)
                .attr("name", &cx_ref.name)
                .self_close();
            w.start_element("xdr:cNvGraphicFramePr").self_close();
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform (zeroed — position comes from the anchor)
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", 0)
                .attr_num("y", 0)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", 0)
                .attr_num("cy", 0)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with ChartEx reference
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", NS_CX)
                .end_attrs();
            {
                w.start_element("cx:chart")
                    .attr("xmlns:cx", NS_CX)
                    .attr("xmlns:r", NS_R)
                    .attr("r:id", &cx_ref.r_id)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
        w.end_element("mc:Choice");

        // mc:Fallback — placeholder shape for older Excel versions
        w.start_element("mc:Fallback").end_attrs();
        {
            let el = w.start_element("xdr:sp");
            if let Some(ref m) = cx_ref.macro_name {
                el.attr("macro", m);
            }
            el.attr("textlink", "").end_attrs();

            // Non-visual shape properties
            w.start_element("xdr:nvSpPr").end_attrs();
            {
                w.start_element("xdr:cNvPr")
                    .attr_num("id", 0)
                    .attr("name", "")
                    .self_close();
                w.start_element("xdr:cNvSpPr").end_attrs();
                {
                    w.start_element("a:spLocks")
                        .attr("noTextEdit", "1")
                        .self_close();
                }
                w.end_element("xdr:cNvSpPr");
            }
            w.end_element("xdr:nvSpPr");

            // Shape properties with fallback geometry
            w.start_element("xdr:spPr").end_attrs();
            {
                w.start_element("a:xfrm").end_attrs();
                {
                    w.start_element("a:off")
                        .attr_num("x", cx_ref.fallback_off_x)
                        .attr_num("y", cx_ref.fallback_off_y)
                        .self_close();
                    w.start_element("a:ext")
                        .attr_num("cx", cx_ref.fallback_ext_cx)
                        .attr_num("cy", cx_ref.fallback_ext_cy)
                        .self_close();
                }
                w.end_element("a:xfrm");

                w.start_element("a:prstGeom")
                    .attr("prst", "rect")
                    .end_attrs();
                {
                    w.start_element("a:avLst").self_close();
                }
                w.end_element("a:prstGeom");

                // White fill with green border
                w.start_element("a:solidFill").end_attrs();
                {
                    w.start_element("a:prstClr")
                        .attr("val", "white")
                        .self_close();
                }
                w.end_element("a:solidFill");

                w.start_element("a:ln").attr_num("w", 1).end_attrs();
                {
                    w.start_element("a:solidFill").end_attrs();
                    {
                        w.start_element("a:prstClr")
                            .attr("val", "green")
                            .self_close();
                    }
                    w.end_element("a:solidFill");
                }
                w.end_element("a:ln");
            }
            w.end_element("xdr:spPr");

            // Fallback text body with warning message
            w.start_element("xdr:txBody").end_attrs();
            {
                w.start_element("a:bodyPr")
                    .attr("vertOverflow", "clip")
                    .attr("horzOverflow", "clip")
                    .self_close();
                w.start_element("a:lstStyle").self_close();
                w.start_element("a:p").end_attrs();
                {
                    w.start_element("a:r").end_attrs();
                    {
                        w.start_element("a:rPr")
                            .attr("lang", "en-US")
                            .attr_num("sz", 1100)
                            .self_close();
                        w.element_with_text(
                            "a:t",
                            "This chart isn\u{2019}t available in your version of Excel.\n\n\
                             Editing this shape or saving this workbook into a different file \
                             format will permanently break the chart.",
                        );
                    }
                    w.end_element("a:r");
                }
                w.end_element("a:p");
            }
            w.end_element("xdr:txBody");

            w.end_element("xdr:sp");
        }
        w.end_element("mc:Fallback");

        w.end_element("mc:AlternateContent");
    }
}
