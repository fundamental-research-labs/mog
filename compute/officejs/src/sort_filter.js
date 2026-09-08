(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

  function richError(code, message) {
    return new global.OfficeExtension.Error({
      code: code,
      message: message,
    });
  }

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

  function assertSameContext(object, context, message) {
    if (object && object.context !== context) {
      throw richError(
        "InvalidRequestContext",
        message || "The object belongs to a different request context."
      );
    }
  }

  function RangeSort(context, range) {
    ClientObject.call(this, context);
    this._range = range;
  }
  RangeSort.prototype = Object.create(ClientObject.prototype);
  RangeSort.prototype.constructor = RangeSort;

  RangeSort.prototype.apply = function (
    fields,
    matchCase,
    hasHeaders,
    orientation,
    method
  ) {
    if (!Array.isArray(fields)) {
      throw richError(
        "InvalidArgument",
        "Range.sort.apply requires an array of SortField objects."
      );
    }
    if (matchCase !== undefined && typeof matchCase !== "boolean") {
      throw richError("InvalidArgument", "Range.sort.apply matchCase must be a boolean.");
    }
    if (hasHeaders !== undefined && typeof hasHeaders !== "boolean") {
      throw richError("InvalidArgument", "Range.sort.apply hasHeaders must be a boolean.");
    }
    if (orientation !== undefined && typeof orientation !== "string") {
      throw richError("InvalidArgument", "Range.sort.apply orientation must be a string.");
    }
    if (method !== undefined && typeof method !== "string") {
      throw richError("InvalidArgument", "Range.sort.apply method must be a string.");
    }
    var op = {
      op: "rangeSort",
      rangeId: this._range._id,
      fields: fields,
    };
    if (matchCase !== undefined) op.matchCase = matchCase;
    if (hasHeaders !== undefined) op.hasHeaders = hasHeaders;
    if (orientation !== undefined) op.orientation = orientation;
    if (method !== undefined) op.method = method;
    this.context._queue.push(op);
  };

  RangeSort.prototype.toJSON = function () {
    return {};
  };

  function addScalarProperty(object, name) {
    Object.defineProperty(object, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  }

  function AutoFilter(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet;
    this._scalarProperties = ["criteria", "enabled", "isDataFiltered"];
    this._navigationProperties = [];
  }
  AutoFilter.prototype = Object.create(ClientObject.prototype);
  AutoFilter.prototype.constructor = AutoFilter;

  ["criteria", "enabled", "isDataFiltered"].forEach(function (name) {
    addScalarProperty(AutoFilter.prototype, name);
  });

  AutoFilter.prototype.apply = function (range, columnIndex, criteria) {
    var op = {
      op: "autoFilterApply",
      id: this._id,
      worksheetId: this._worksheet._id,
    };
    if (range instanceof Excel.Range) {
      assertSameContext(range, this.context);
      op.rangeId = range._id;
    } else if (typeof range === "string") {
      op.address = range;
    } else {
      throw richError(
        "InvalidArgument",
        "AutoFilter.apply requires a Range or range address string."
      );
    }
    if (columnIndex !== undefined) {
      if (
        typeof columnIndex !== "number" ||
        !Number.isFinite(columnIndex) ||
        Math.floor(columnIndex) !== columnIndex
      ) {
        throw richError(
          "InvalidArgument",
          "AutoFilter.apply columnIndex must be a finite integer."
        );
      }
      op.columnIndex = columnIndex;
    }
    if (criteria !== undefined) {
      // `criteria` is an optional object in the Office.js contract.  Keeping
      // null distinct from omission prevents a supplied null from silently
      // becoming an unfiltered apply at the Rust/serde boundary.
      if (criteria === null || typeof criteria !== "object" || Array.isArray(criteria)) {
        throw richError(
          "InvalidArgument",
          "AutoFilter.apply criteria must be a FilterCriteria object."
        );
      }
      op.criteria = criteria;
    }
    this.context._queue.push(op);
  };

  AutoFilter.prototype.clearColumnCriteria = function (columnIndex) {
    this.context._queue.push({
      op: "autoFilterClearColumnCriteria",
      id: this._id,
      columnIndex: columnIndex,
    });
  };

  AutoFilter.prototype.clearCriteria = function () {
    this.context._queue.push({
      op: "autoFilterClearCriteria",
      id: this._id,
    });
  };

  function autoFilterRange(autoFilter, nullObject) {
    var range = new Excel.Range(autoFilter.context, autoFilter._worksheet, null);
    // Range is defined in bootstrap.js.  The null-object scalar is attached
    // here so this module remains a separately loaded Office.js surface.
    if (range._scalarProperties.indexOf("isNullObject") < 0) {
      range._scalarProperties.push("isNullObject");
    }
    range._isNullObject = false;
    Object.defineProperty(range, "isNullObject", {
      get: function () {
        if (!this._loaded.isNullObject) throw propertyNotLoaded("isNullObject");
        return this._isNullObject;
      },
    });
    autoFilter.context._queue.push({
      op: "autoFilterGetRange",
      id: range._id,
      autoFilterId: autoFilter._id,
      worksheetId: autoFilter._worksheet._id,
      nullObject: nullObject === true,
    });
    return range;
  }

  AutoFilter.prototype.getRange = function () {
    return autoFilterRange(this, false);
  };

  AutoFilter.prototype.getRangeOrNullObject = function () {
    return autoFilterRange(this, true);
  };

  AutoFilter.prototype.reapply = function () {
    this.context._queue.push({
      op: "autoFilterReapply",
      id: this._id,
    });
  };

  AutoFilter.prototype.remove = function () {
    this.context._queue.push({
      op: "autoFilterRemove",
      id: this._id,
    });
  };

  AutoFilter.prototype.toJSON = function () {
    var data = {};
    if (this._loaded.criteria) data.criteria = this._criteria;
    if (this._loaded.enabled) data.enabled = this._enabled;
    if (this._loaded.isDataFiltered) data.isDataFiltered = this._isDataFiltered;
    return data;
  };

  Object.defineProperty(Excel.Range.prototype, "sort", {
    get: function () {
      if (!this._sort) this._sort = new RangeSort(this.context, this);
      return this._sort;
    },
  });

  Object.defineProperty(Excel.Worksheet.prototype, "autoFilter", {
    get: function () {
      if (!this._autoFilter) {
        this._autoFilter = new AutoFilter(this.context, this);
        // Worksheet.autoFilter is a navigational object.  Bind it eagerly so
        // loading enabled/criteria before the first apply resolves against
        // the correct worksheet (including the disabled/no-filter state).
        this.context._queue.push({
          op: "getAutoFilter",
          id: this._autoFilter._id,
          worksheetId: this._id,
        });
      }
      return this._autoFilter;
    },
  });

  Excel.RangeSort = RangeSort;
  Excel.AutoFilter = AutoFilter;
})(globalThis);
