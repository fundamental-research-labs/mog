(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;

  function invalidRequestContext() {
    return new OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
  }

  function queueRange(source, method, args) {
    var result = new Excel.Range(source.context, source._worksheet, null);
    source.context._queue.push({
      op: "rangeNavigation",
      id: result._id,
      rangeId: source._id,
      method: method,
      args: args || [],
    });
    return result;
  }

  function queueWorksheetRange(worksheet, method, args) {
    var result = new Excel.Range(worksheet.context, worksheet, null);
    worksheet.context._queue.push({
      op: "rangeNavigation",
      id: result._id,
      worksheetId: worksheet._id,
      method: method,
      args: args || [],
    });
    return result;
  }

  function rangeArgument(source, value) {
    if (value instanceof Excel.Range) {
      if (value.context !== source.context) throw invalidRequestContext();
      return { rangeId: value._id };
    }
    return value;
  }

  function optionalCount(count) {
    return count === undefined ? 1 : count;
  }

  // Worksheet.getCell(row, column)
  Excel.Worksheet.prototype.getCell = function (row, column) {
    return queueWorksheetRange(this, "worksheet.getCell", [row, column]);
  };

  // Range methods that return another Range. The returned proxy is created
  // immediately, while all geometry and error handling stays deferred to the
  // host's rangeNavigation operation at context.sync().
  Excel.Range.prototype.getCell = function (row, column) {
    return queueRange(this, "getCell", [row, column]);
  };

  Excel.Range.prototype.getRow = function (row) {
    return queueRange(this, "getRow", [row]);
  };

  Excel.Range.prototype.getColumn = function (column) {
    return queueRange(this, "getColumn", [column]);
  };

  Excel.Range.prototype.getLastCell = function () {
    return queueRange(this, "getLastCell");
  };

  Excel.Range.prototype.getLastRow = function () {
    return queueRange(this, "getLastRow");
  };

  Excel.Range.prototype.getLastColumn = function () {
    return queueRange(this, "getLastColumn");
  };

  Excel.Range.prototype.getOffsetRange = function (rowOffset, columnOffset) {
    return queueRange(this, "getOffsetRange", [rowOffset, columnOffset]);
  };

  Excel.Range.prototype.getResizedRange = function (deltaRows, deltaColumns) {
    return queueRange(this, "getResizedRange", [deltaRows, deltaColumns]);
  };

  Excel.Range.prototype.getAbsoluteResizedRange = function (numRows, numColumns) {
    return queueRange(this, "getAbsoluteResizedRange", [numRows, numColumns]);
  };

  Excel.Range.prototype.getRowsAbove = function (count) {
    return queueRange(this, "getRowsAbove", [optionalCount(count)]);
  };

  Excel.Range.prototype.getRowsBelow = function (count) {
    return queueRange(this, "getRowsBelow", [optionalCount(count)]);
  };

  Excel.Range.prototype.getColumnsBefore = function (count) {
    return queueRange(this, "getColumnsBefore", [optionalCount(count)]);
  };

  Excel.Range.prototype.getColumnsAfter = function (count) {
    return queueRange(this, "getColumnsAfter", [optionalCount(count)]);
  };

  Excel.Range.prototype.getBoundingRect = function (anotherRange) {
    return queueRange(this, "getBoundingRect", [rangeArgument(this, anotherRange)]);
  };

  Excel.Range.prototype.getIntersection = function (anotherRange) {
    return queueRange(this, "getIntersection", [rangeArgument(this, anotherRange)]);
  };

  Excel.Range.prototype.getEntireRow = function () {
    return queueRange(this, "getEntireRow");
  };

  Excel.Range.prototype.getEntireColumn = function () {
    return queueRange(this, "getEntireColumn");
  };
})(globalThis);
