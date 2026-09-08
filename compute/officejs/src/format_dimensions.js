(function (global) {
  "use strict";

  // RangeFormat's visual properties live in format.js.  Dimensions are kept
  // in this extension so the same RangeFormat proxy can expose layout fields
  // without turning the layout state into a cell-format field.  The host
  // receives the ordinary generic set/load operations for scalar dimensions
  // and a dedicated rangeFormatAutofit operation for the two methods.
  var Excel = global.Excel;
  var officeJs = global.__mogOfficeJs || {};
  var prototype = Excel.RangeFormat && Excel.RangeFormat.prototype;

  if (!prototype) return;

  var DIMENSION_PROPERTIES = [
    "columnWidth",
    "rowHeight",
    "useStandardHeight",
    "useStandardWidth",
  ];

  function propertyNotLoaded(name) {
    var error = new global.OfficeExtension.Error({
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

  function defineDimension(name) {
    if (Object.getOwnPropertyDescriptor(prototype, name)) return;
    Object.defineProperty(prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        this["_" + name] = value;
        this._loaded[name] = true;
        this.context._queue.push({
          op: "set",
          id: this._id,
          property: name,
          value: value,
        });
      },
    });
  }

  DIMENSION_PROPERTIES.forEach(defineDimension);
  if (typeof officeJs.addScalarProperties === "function") {
    officeJs.addScalarProperties(prototype, DIMENSION_PROPERTIES);
  } else {
    prototype._additionalScalarProperties = DIMENSION_PROPERTIES.slice();
  }

  // format.js computes scalar members dynamically from both lists.  Keeping
  // dimensions in the additional list therefore makes ordinary set() and
  // toJSON() handle them exactly once, preserving the base setter's queue
  // order and avoiding duplicate dimension operations.

  function queueAutofit(format, axis) {
    format.context._queue.push({
      op: "rangeFormatAutofit",
      id: format._id,
      axis: axis,
    });
  }

  prototype.autofitColumns = function () {
    queueAutofit(this, "columns");
  };

  prototype.autofitRows = function () {
    queueAutofit(this, "rows");
  };
})(globalThis);
