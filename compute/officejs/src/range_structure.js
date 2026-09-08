(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;

  function invalidArgument(message) {
    var error = new OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = "InvalidArgument";
    return error;
  }

  function propertyNotLoaded(name) {
    var error = new OfficeExtension.Error({
      code: "PropertyNotLoaded",
      message:
        "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context.",
    });
    error.name = "RichApi.Error";
    error.code = "PropertyNotLoaded";
    return error;
  }

  function normalizeColumns(columns) {
    if (!Array.isArray(columns) || columns.length === 0) {
      throw invalidArgument(
        "Range.removeDuplicates columns must be a non-empty number array"
      );
    }
    var normalized = [];
    for (var index = 0; index < columns.length; index++) {
      var column = columns[index];
      if (
        typeof column !== "number" ||
        !isFinite(column) ||
        Math.floor(column) !== column ||
        column < 0 ||
        column > 4294967295
      ) {
        throw invalidArgument(
          "Range.removeDuplicates columns[" + index + "] must be a non-negative integer"
        );
      }
      normalized.push(column);
    }
    return normalized;
  }

  function normalizeBoolean(value, name) {
    if (typeof value !== "boolean") {
      throw invalidArgument("Range.removeDuplicates " + name + " must be a boolean");
    }
    return value;
  }

  function normalizeGroupOption(value, method) {
    if (value !== "ByRows" && value !== "ByColumns") {
      throw invalidArgument(
        "Range." + method + " groupOption must be 'ByRows' or 'ByColumns'"
      );
    }
    return value;
  }

  function RemoveDuplicatesResult(context) {
    ClientObject.call(this, context);
    this._scalarProperties = ["removed", "uniqueRemaining"];
  }
  RemoveDuplicatesResult.prototype = Object.create(ClientObject.prototype);
  RemoveDuplicatesResult.prototype.constructor = RemoveDuplicatesResult;

  ["removed", "uniqueRemaining"].forEach(function (name) {
    Object.defineProperty(RemoveDuplicatesResult.prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  });

  RemoveDuplicatesResult.prototype.toJSON = function () {
    var data = {};
    ["removed", "uniqueRemaining"].forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    return data;
  };

  Excel.RemoveDuplicatesResult = RemoveDuplicatesResult;

  // Structural operations stay deferred until context.sync(), matching the
  // rest of the Office.js request model.  The host binds the Range returned by
  // insert at the same address after the engine has created the blank space.
  Excel.Range.prototype.insert = function (shift) {
    var result = new Excel.Range(this.context, this._worksheet, this._address);
    this.context._queue.push({
      op: "rangeInsert",
      id: result._id,
      rangeId: this._id,
      shift: shift,
    });
    return result;
  };

  Excel.Range.prototype.delete = function (shift) {
    this.context._queue.push({
      op: "rangeDelete",
      id: this._id,
      shift: shift,
    });
  };

  Excel.Range.prototype.merge = function (across) {
    this.context._queue.push({
      op: "rangeMerge",
      id: this._id,
      across: across === true,
    });
  };

  Excel.Range.prototype.unmerge = function () {
    this.context._queue.push({
      op: "rangeUnmerge",
      id: this._id,
    });
  };

  Excel.Range.prototype.removeDuplicates = function (columns, includesHeader) {
    var normalizedColumns = normalizeColumns(columns);
    var normalizedHeader = normalizeBoolean(includesHeader, "includesHeader");
    var result = new RemoveDuplicatesResult(this.context);
    this.context._queue.push({
      op: "rangeRemoveDuplicates",
      id: result._id,
      rangeId: this._id,
      columns: normalizedColumns,
      includesHeader: normalizedHeader,
    });
    return result;
  };

  Excel.Range.prototype.group = function (groupOption) {
    this.context._queue.push({
      op: "rangeGroup",
      id: this._id,
      groupOption: normalizeGroupOption(groupOption, "group"),
    });
  };

  Excel.Range.prototype.ungroup = function (groupOption) {
    this.context._queue.push({
      op: "rangeUngroup",
      id: this._id,
      groupOption: normalizeGroupOption(groupOption, "ungroup"),
    });
  };
})(globalThis);
