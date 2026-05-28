use crate::output::results::HyperlinkOutput;
use crate::write::xml_writer::XmlWriter;

pub(super) fn write_hyperlinks(w: &mut XmlWriter, hyperlinks: &[HyperlinkOutput]) {
    if hyperlinks.is_empty() {
        return;
    }

    w.start_element("hyperlinks").end_attrs();
    for hl in hyperlinks {
        let el = w.start_element("hyperlink").attr("ref", &hl.cell_ref);
        if let Some(r_id) = &hl.r_id {
            el.attr("r:id", r_id);
        }
        if !hl.location.is_empty() {
            el.attr("location", &hl.location);
        }
        if !hl.display.is_empty() {
            el.attr("display", &hl.display);
        }
        if !hl.tooltip.is_empty() {
            el.attr("tooltip", &hl.tooltip);
        }
        if let Some(uid) = &hl.uid {
            el.attr("xr:uid", uid);
        }
        el.self_close();
    }
    w.end_element("hyperlinks");
}
