use compute_api::Sheet;
use serde_json::{Value, json};

const EMU_PER_POINT: f64 = 12700.0;
const PIXELS_PER_POINT: f64 = 4.0 / 3.0;

fn object(sheet: &Sheet, id: &str) -> Result<Value, String> {
    let object = sheet
        .charts()
        .get(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Chart is unavailable".to_string())?;
    serde_json::to_value(object).map_err(|e| e.to_string())
}

fn origin(sheet: &Sheet, value: &Value) -> Result<(f64, f64), String> {
    let a = &value["anchor"];
    if a["anchorMode"] == "absolute" {
        return Ok((
            a["absoluteXEmu"].as_f64().unwrap_or(0.0) / EMU_PER_POINT,
            a["absoluteYEmu"].as_f64().unwrap_or(0.0) / EMU_PER_POINT,
        ));
    }
    let row = a["anchorRow"].as_u64().unwrap_or(0) as u32;
    let col = a["anchorCol"].as_u64().unwrap_or(0) as u32;
    Ok((
        sheet
            .layout()
            .get_col_position(col)
            .map_err(|e| e.to_string())?
            / PIXELS_PER_POINT
            + a["anchorColOffsetEmu"].as_f64().unwrap_or(0.0) / EMU_PER_POINT,
        sheet
            .layout()
            .get_row_position(row)
            .map_err(|e| e.to_string())?
            / PIXELS_PER_POINT
            + a["anchorRowOffsetEmu"].as_f64().unwrap_or(0.0) / EMU_PER_POINT,
    ))
}

pub(crate) fn get(sheet: &Sheet, id: &str, property: &str) -> Result<Value, String> {
    let value = object(sheet, id)?;
    match property {
        "name" => Ok(value["name"].clone()),
        "left" => Ok(json!(origin(sheet, &value)?.0)),
        "top" => Ok(json!(origin(sheet, &value)?.1)),
        "width" | "height" => Ok(json!(
            value[property].as_f64().unwrap_or(0.0) / PIXELS_PER_POINT
        )),
        _ => Err(format!("Unsupported Chart load property '{property}'")),
    }
}

pub(crate) fn set(sheet: &Sheet, id: &str, property: &str, value: &Value) -> Result<(), String> {
    let current = object(sheet, id)?;
    let mut updates = json!({});
    match property {
        "name" => {
            let name = value
                .as_str()
                .filter(|v| !v.is_empty())
                .ok_or("Chart.name requires a nonempty string")?;
            updates["name"] = json!(name);
        }
        "legend.visible" | "legend.position" => {
            let mut legend = current["legend"].clone();
            if !legend.is_object() {
                legend = json!({"show":true,"visible":true,"position":"right"});
            }
            if property == "legend.visible" {
                let visible = value
                    .as_bool()
                    .ok_or("Chart.legend.visible requires a boolean")?;
                legend["show"] = json!(visible);
                legend["visible"] = json!(visible);
            } else {
                let position = match value.as_str() {
                    Some("Bottom") => "bottom",
                    Some("Top") => "top",
                    Some("Left") => "left",
                    Some("Right") => "right",
                    Some("Corner") => "topRight",
                    _ => return Err("Unsupported Chart.legend.position".into()),
                };
                legend["position"] = json!(position);
            }
            updates["legend"] = legend;
        }
        "left" | "top" | "width" | "height" => {
            let number = value
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.0 && *n <= (i64::MAX as f64) / EMU_PER_POINT)
                .ok_or("Chart geometry requires finite nonnegative point units")?;
            if matches!(property, "width" | "height") && number == 0.0 {
                return Err("Chart size must be positive".into());
            }
            let (mut left, mut top) = origin(sheet, &current)?;
            let mut width = current["width"]
                .as_f64()
                .ok_or("Chart width is unavailable")?
                / PIXELS_PER_POINT;
            let mut height = current["height"]
                .as_f64()
                .ok_or("Chart height is unavailable")?
                / PIXELS_PER_POINT;
            match property {
                "left" => left = number,
                "top" => top = number,
                "width" => width = number,
                _ => height = number,
            }
            updates = json!({"width":width*PIXELS_PER_POINT,"height":height*PIXELS_PER_POINT,
                "anchorCellId":null,"toAnchorCellId":null,
                "anchor":{"anchorMode":"absolute","anchorRow":0,"anchorCol":0,
                "anchorRowOffsetEmu":0,"anchorColOffsetEmu":0,
                "absoluteXEmu":(left*EMU_PER_POINT).round() as i64,"absoluteYEmu":(top*EMU_PER_POINT).round() as i64,
                "extentCxEmu":(width*EMU_PER_POINT).round() as i64,"extentCyEmu":(height*EMU_PER_POINT).round() as i64,
                "endRow":null,"endCol":null,"endRowOffsetEmu":null,"endColOffsetEmu":null}});
            if matches!(property, "width" | "height")
                && current["anchor"]["anchorMode"] != "absolute"
            {
                // Resizing must not bake a platform-specific cell origin into
                // absolute coordinates. Preserve the existing start marker.
                let mut anchor = current["anchor"].clone();
                anchor["anchorMode"] = json!("oneCell");
                for key in [
                    "absoluteXEmu",
                    "absoluteYEmu",
                    "endRow",
                    "endCol",
                    "endRowOffsetEmu",
                    "endColOffsetEmu",
                ] {
                    anchor[key] = Value::Null;
                }
                anchor["extentCxEmu"] = json!((width * EMU_PER_POINT).round() as i64);
                anchor["extentCyEmu"] = json!((height * EMU_PER_POINT).round() as i64);
                updates["anchor"] = anchor;
                updates["anchorCellId"] = current["anchorCellId"].clone();
            }
        }
        "setPosition" => {
            let bounds = |v: &Value| -> Result<(u32, u32, u32, u32), String> {
                let address = v["address"]
                    .as_str()
                    .ok_or("Chart.setPosition requires a bounded address")?;
                let range = crate::range_navigation::parse_range_address(sheet, address)
                    .map_err(|e| e.message)?;
                let bounds = range.bounds();
                if bounds.0 != bounds.2 || bounds.1 != bounds.3 {
                    return Err("Chart.setPosition currently requires single-cell endpoints".into());
                }
                Ok(bounds)
            };
            let (sr, sc, _, _) = bounds(&value["start"])?;
            let left = sheet
                .layout()
                .get_col_position(sc)
                .map_err(|e| e.to_string())?;
            let top = sheet
                .layout()
                .get_row_position(sr)
                .map_err(|e| e.to_string())?;
            if value["end"].is_null() {
                updates = json!({"anchorCellId":null,"toAnchorCellId":null,"anchor":{"anchorMode":"oneCell",
                    "anchorRow":sr,"anchorCol":sc,"anchorRowOffsetEmu":0,"anchorColOffsetEmu":0,
                    "absoluteXEmu":null,"absoluteYEmu":null,"endRow":null,"endCol":null,
                    "endRowOffsetEmu":null,"endColOffsetEmu":null,
                    "extentCxEmu":(current["width"].as_f64().ok_or("Chart width is unavailable")?*9525.0).round() as i64,
                    "extentCyEmu":(current["height"].as_f64().ok_or("Chart height is unavailable")?*9525.0).round() as i64}});
            } else {
                let (_, _, er, ec) = bounds(&value["end"])?;
                if er < sr || ec < sc {
                    return Err("Chart.setPosition end must not precede start".into());
                }
                let end_row = er.checked_add(1).ok_or("Invalid end row")?;
                let end_col = ec.checked_add(1).ok_or("Invalid end column")?;
                let width = sheet
                    .layout()
                    .get_col_position(end_col)
                    .map_err(|e| e.to_string())?
                    - left;
                let height = sheet
                    .layout()
                    .get_row_position(end_row)
                    .map_err(|e| e.to_string())?
                    - top;
                if width <= 0.0 || height <= 0.0 {
                    return Err("Chart position must have positive visible size".into());
                }
                updates = json!({"width":width,"height":height,"anchorCellId":null,"toAnchorCellId":null,
                    "anchor":{"anchorMode":"twoCell","anchorRow":sr,"anchorCol":sc,
                    "anchorRowOffsetEmu":0,"anchorColOffsetEmu":0,"endRow":end_row,"endCol":end_col,
                    "endRowOffsetEmu":0,"endColOffsetEmu":0,"absoluteXEmu":null,"absoluteYEmu":null,
                    "extentCxEmu":null,"extentCyEmu":null}});
            }
        }
        _ => return Err(format!("Unsupported Chart property '{property}'")),
    }
    sheet
        .charts()
        .update(id, &updates)
        .map_err(|e| e.to_string())?;
    Ok(())
}
