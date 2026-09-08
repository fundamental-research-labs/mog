(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;

  // `Range.copyFrom` and `Range.moveTo` are mutations.  Keep argument checks
  // that Office.js can perform without touching the workbook synchronous, and
  // defer address/object-path/worksheet validation to context.sync().
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
    var error = new OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
    error.name = "RichApi.Error";
    error.code = "InvalidRequestContext";
    return error;
  }

  var copyTypes = {
    All: true,
    Formulas: true,
    Values: true,
    Formats: true,
    Link: true,
  };

  function normalizeCopyType(copyType) {
    if (copyType === undefined) return "All";
    if (typeof copyType !== "string" || !copyTypes[copyType]) {
      throw invalidArgument(
        "Range.copyFrom copyType must be one of All, Formulas, Values, Formats, or Link."
      );
    }
    return copyType;
  }

  function normalizeBoolean(value, name, defaultValue) {
    if (value === undefined) return defaultValue;
    if (typeof value !== "boolean") {
      throw invalidArgument("Range.copyFrom " + name + " must be a boolean.");
    }
    return value;
  }

  function sourceDescriptor(range, context) {
    if (range instanceof Excel.Range) {
      if (range.context !== context) throw invalidRequestContext();
      return { sourceRangeId: range._id };
    }
    if (typeof range === "string") {
      if (range.trim().length === 0) {
        throw invalidArgument("Range.copyFrom sourceRange cannot be empty.");
      }
      return { sourceAddress: range };
    }
    throw invalidArgument(
      "Range.copyFrom sourceRange must be a Range or range address string."
    );
  }

  function destinationDescriptor(range, context) {
    if (range instanceof Excel.Range) {
      if (range.context !== context) throw invalidRequestContext();
      return { destinationRangeId: range._id };
    }
    if (typeof range === "string") {
      if (range.trim().length === 0) {
        throw invalidArgument("Range.moveTo destinationRange cannot be empty.");
      }
      return { destinationAddress: range };
    }
    throw invalidArgument(
      "Range.moveTo destinationRange must be a Range or range address string."
    );
  }

  Excel.Range.prototype.copyFrom = function (
    sourceRange,
    copyType,
    skipBlanks,
    transpose
  ) {
    var source = sourceDescriptor(sourceRange, this.context);
    var op = {
      op: "rangeCopy",
      id: this._id,
      copyType: normalizeCopyType(copyType),
      skipBlanks: normalizeBoolean(skipBlanks, "skipBlanks", false),
      transpose: normalizeBoolean(transpose, "transpose", false),
    };
    Object.keys(source).forEach(function (key) {
      op[key] = source[key];
    });
    this.context._queue.push(op);
  };

  Excel.Range.prototype.moveTo = function (destinationRange) {
    var destination = destinationDescriptor(destinationRange, this.context);
    var op = { op: "rangeMove", id: this._id };
    Object.keys(destination).forEach(function (key) {
      op[key] = destination[key];
    });
    this.context._queue.push(op);
  };
})(globalThis);
