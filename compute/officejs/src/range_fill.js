(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;

  function invalidArgument(message) {
    var error = new OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = "InvalidArgument";
    return error;
  }

  function invalidRequestContext() {
    var error = new global.OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
    error.name = "RichApi.Error";
    error.code = "InvalidRequestContext";
    return error;
  }

  function rangeArgument(source, value) {
    if (value instanceof Excel.Range) {
      if (value.context !== source.context) throw invalidRequestContext();
      return { destinationRangeId: value._id };
    }
    if (typeof value === "string") {
      if (value.trim().length === 0) {
        throw invalidArgument("Range.autoFill destinationRange cannot be empty.");
      }
      return { destinationAddress: value };
    }
    if (value === undefined || value === null) return {};
    throw invalidArgument(
      "Range.autoFill destinationRange must be a Range, range address string, or null."
    );
  }

  var autoFillTypes = {
    FillDefault: true,
    FillCopy: true,
    FillSeries: true,
    FillFormats: true,
    FillValues: true,
    FillDays: true,
    FillWeekdays: true,
    FillMonths: true,
    FillYears: true,
    LinearTrend: true,
    GrowthTrend: true,
    FlashFill: true,
  };

  function normalizeAutoFillType(value) {
    if (value === undefined) return null;
    if (
      typeof value !== "string" ||
      !Object.prototype.hasOwnProperty.call(autoFillTypes, value)
    ) {
      throw invalidArgument(
        "Range.autoFill autoFillType must be one of FillDefault, FillCopy, FillSeries, FillFormats, FillValues, FillDays, FillWeekdays, FillMonths, FillYears, LinearTrend, GrowthTrend, or FlashFill."
      );
    }
    return value;
  }

  // Range.autoFill and Range.flashFill are the complete fill-method surface
  // in the pinned Excel declarations. In particular, the declarations do not
  // contain Range.fillDown/fillRight/fillUp/fillLeft; adding those would make
  // this runtime expose an API that Microsoft does not declare.
  Excel.Range.prototype.autoFill = function (destinationRange, autoFillType) {
    var op = {
      op: "rangeAutoFill",
      id: this._id,
      autoFillType: normalizeAutoFillType(autoFillType),
    };
    var destination = rangeArgument(this, destinationRange);
    Object.keys(destination).forEach(function (key) {
      op[key] = destination[key];
    });
    this.context._queue.push(op);
  };

  Excel.Range.prototype.flashFill = function () {
    this.context._queue.push({
      op: "rangeFlashFill",
      id: this._id,
    });
  };
})(globalThis);
