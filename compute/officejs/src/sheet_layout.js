(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

  var PAGE_LAYOUT_PROPERTIES = [
    "alignMarginsHeaderFooter",
    "blackAndWhite",
    "bottomMargin",
    "centerHorizontally",
    "centerVertically",
    "draftMode",
    "firstPageNumber",
    "footerMargin",
    "headerMargin",
    "leftMargin",
    "orientation",
    "paperSize",
    "printComments",
    "printErrors",
    "printGridlines",
    "printHeadings",
    "printOrder",
    "printQuality",
    "rightMargin",
    "topMargin",
    "zoom",
  ];

  var BOOLEAN_PAGE_LAYOUT_PROPERTIES = {
    alignMarginsHeaderFooter: true,
    blackAndWhite: true,
    centerHorizontally: true,
    centerVertically: true,
    draftMode: true,
    printGridlines: true,
    printHeadings: true,
  };

  var PAPER_TYPES = [
    "Letter",
    "LetterSmall",
    "Tabloid",
    "Ledger",
    "Legal",
    "Statement",
    "Executive",
    "A3",
    "A4",
    "A4Small",
    "A5",
    "B4",
    "B5",
    "Folio",
    "Quatro",
    "Paper10x14",
    "Paper11x17",
    "Note",
    "Envelope9",
    "Envelope10",
    "Envelope11",
    "Envelope12",
    "Envelope14",
    "Csheet",
    "Dsheet",
    "Esheet",
    "EnvelopeDL",
    "EnvelopeC5",
    "EnvelopeC3",
    "EnvelopeC4",
    "EnvelopeC6",
    "EnvelopeC65",
    "EnvelopeB4",
    "EnvelopeB5",
    "EnvelopeB6",
    "EnvelopeItaly",
    "EnvelopeMonarch",
    "EnvelopePersonal",
    "FanfoldUS",
    "FanfoldStdGerman",
    "FanfoldLegalGerman",
  ];

  var PRINT_COMMENTS = ["NoComments", "EndSheet", "InPlace"];
  var PRINT_ERRORS = ["AsDisplayed", "Blank", "Dash", "NotAvailable"];
  var PRINT_ORDER = ["DownThenOver", "OverThenDown"];
  var PRINT_MARGIN_UNITS = ["Points", "Inches", "Centimeters"];
  var ZOOM_PROPERTIES = ["horizontalFitToPages", "scale", "verticalFitToPages"];
  var MARGIN_PROPERTIES = ["bottom", "footer", "header", "left", "right", "top"];

  function richApiError(code, message) {
    var error = new OfficeExtension.Error({ code: code, message: message });
    error.name = "RichApi.Error";
    error.code = code;
    return error;
  }

  function invalid(message) {
    return richApiError("InvalidArgument", message);
  }

  function invalidContext() {
    return richApiError(
      "InvalidRequestContext",
      "The object belongs to a different request context."
    );
  }

  function unsupported(message) {
    return richApiError("ApiNotFound", message);
  }

  function propertyNotLoaded(name) {
    return richApiError(
      "PropertyNotLoaded",
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, name) {
    return Object.prototype.hasOwnProperty.call(object, name);
  }

  function requireSameContext(value, context, property) {
    if (value.context !== context) throw invalidContext();
    if (property && value[property] === null) {
      throw invalid(property + " cannot be an unbounded Range");
    }
  }

  function requireFiniteNumber(value, property, integer) {
    if (typeof value !== "number" || !isFinite(value)) {
      throw invalid(property + " must be a finite number");
    }
    if (integer && Math.floor(value) !== value) {
      throw invalid(property + " must be an integer");
    }
    return value;
  }

  function requireNonNegativeNumber(value, property, integer) {
    requireFiniteNumber(value, property, integer);
    if (value < 0) throw invalid(property + " must be non-negative");
    return value;
  }

  function requireBoolean(value, property) {
    if (typeof value !== "boolean") {
      throw invalid(property + " must be a boolean");
    }
    return value;
  }

  function requireEnum(value, property, allowed) {
    if (typeof value !== "string" || allowed.indexOf(value) < 0) {
      throw invalid(property + " has an unsupported value");
    }
    return value;
  }

  function validateZoom(value) {
    if (!isPlainObject(value)) throw invalid("PageLayout.zoom must be an object");
    Object.keys(value).forEach(function (key) {
      if (ZOOM_PROPERTIES.indexOf(key) < 0) {
        throw invalid("Unsupported PageLayout.zoom property '" + key + "'");
      }
    });
    ["horizontalFitToPages", "verticalFitToPages"].forEach(function (key) {
      if (!own(value, key) || value[key] === null) return;
      requireNonNegativeNumber(value[key], "PageLayout.zoom." + key, true);
    });
    if (own(value, "scale") && value.scale !== null) {
      requireNonNegativeNumber(value.scale, "PageLayout.zoom.scale", true);
      if (value.scale < 10 || value.scale > 400) {
        throw invalid("PageLayout.zoom.scale must be between 10 and 400");
      }
    }
  }

  function validatePageLayoutValue(name, value) {
    if (BOOLEAN_PAGE_LAYOUT_PROPERTIES[name]) {
      requireBoolean(value, "PageLayout." + name);
      return;
    }
    switch (name) {
      case "bottomMargin":
      case "footerMargin":
      case "headerMargin":
      case "leftMargin":
      case "rightMargin":
      case "topMargin":
        requireNonNegativeNumber(value, "PageLayout." + name, false);
        return;
      case "firstPageNumber":
        if (value === "") return;
        requireNonNegativeNumber(value, "PageLayout.firstPageNumber", true);
        return;
      case "orientation":
        requireEnum(value, "PageLayout.orientation", ["Portrait", "Landscape"]);
        return;
      case "paperSize":
        requireEnum(value, "PageLayout.paperSize", PAPER_TYPES);
        return;
      case "printComments":
        requireEnum(value, "PageLayout.printComments", PRINT_COMMENTS);
        return;
      case "printErrors":
        requireEnum(value, "PageLayout.printErrors", PRINT_ERRORS);
        return;
      case "printOrder":
        requireEnum(value, "PageLayout.printOrder", PRINT_ORDER);
        return;
      case "printQuality":
        if (!Array.isArray(value) || value.length !== 2) {
          throw invalid("PageLayout.printQuality must be a two-element number array");
        }
        value.forEach(function (entry, index) {
          requireNonNegativeNumber(entry, "PageLayout.printQuality[" + index + "]", true);
        });
        return;
      case "zoom":
        validateZoom(value);
        return;
      default:
        throw unsupported("PageLayout." + name + " is read-only or unsupported");
    }
  }

  function defineScalarProperty(prototype, name) {
    Object.defineProperty(prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        validatePageLayoutValue(name, value);
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

  function defineWorksheetScalarProperty(prototype, name) {
    Object.defineProperty(prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        if (name === "showGridlines" || name === "showHeadings") {
          requireBoolean(value, "Worksheet." + name);
        } else if (typeof value !== "string") {
          throw invalid("Worksheet.tabColor must be a string");
        }
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

  function WorksheetFreezePanes(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet;
    this._scalarProperties = [];
    this._navigationProperties = [];
    context._queue.push({
      op: "getWorksheetFreezePanes",
      id: this._id,
      worksheetId: worksheet._id,
    });
  }
  WorksheetFreezePanes.prototype = Object.create(ClientObject.prototype);
  WorksheetFreezePanes.prototype.constructor = WorksheetFreezePanes;

  WorksheetFreezePanes.prototype.freezeAt = function (frozenRange) {
    var operation = {
      op: "worksheetFreezeAt",
      id: this._id,
      freezePanesId: this._id,
      worksheetId: this._worksheet._id,
    };
    if (frozenRange === null) {
      operation.clear = true;
    } else if (frozenRange instanceof Excel.Range) {
      requireSameContext(frozenRange, this.context);
      operation.rangeId = frozenRange._id;
    } else if (typeof frozenRange === "string") {
      if (frozenRange.trim() === "") {
        throw invalid("WorksheetFreezePanes.freezeAt requires a range address");
      }
      operation.address = frozenRange;
    } else {
      throw invalid("WorksheetFreezePanes.freezeAt requires a Range, string, or null");
    }
    this.context._queue.push(operation);
  };

  WorksheetFreezePanes.prototype.freezeColumns = function (count) {
    if (count === undefined) count = 1;
    requireNonNegativeNumber(count, "WorksheetFreezePanes.freezeColumns count", true);
    this.context._queue.push({
      op: "worksheetFreezeColumns",
      id: this._id,
      freezePanesId: this._id,
      worksheetId: this._worksheet._id,
      count: count,
    });
  };

  WorksheetFreezePanes.prototype.freezeRows = function (count) {
    if (count === undefined) count = 1;
    requireNonNegativeNumber(count, "WorksheetFreezePanes.freezeRows count", true);
    this.context._queue.push({
      op: "worksheetFreezeRows",
      id: this._id,
      freezePanesId: this._id,
      worksheetId: this._worksheet._id,
      count: count,
    });
  };

  function freezeLocation(freezePanes, orNullObject) {
    var range = new Excel.Range(freezePanes.context, freezePanes._worksheet, null);
    defineNullableRange(range);
    freezePanes.context._queue.push({
      op: "worksheetFreezeGetLocation",
      id: range._id,
      freezePanesId: freezePanes._id,
      worksheetId: freezePanes._worksheet._id,
      orNullObject: orNullObject === true,
    });
    return range;
  }

  // A range returned by an OrNullObject method needs an explicit scalar
  // descriptor. The base Range proxy otherwise treats `isNullObject` as an
  // ordinary inherited fallback and cannot distinguish a null host binding.
  function defineNullableRange(range) {
    if (range._scalarProperties.indexOf("isNullObject") < 0) {
      range._scalarProperties.push("isNullObject");
    }
    range._isNullObject = false;
    Object.defineProperty(range, "isNullObject", {
      configurable: true,
      get: function () {
        if (!this._loaded.isNullObject) throw propertyNotLoaded("isNullObject");
        return this._isNullObject;
      },
    });
  }

  WorksheetFreezePanes.prototype.getLocation = function () {
    return freezeLocation(this, false);
  };

  WorksheetFreezePanes.prototype.getLocationOrNullObject = function () {
    return freezeLocation(this, true);
  };

  WorksheetFreezePanes.prototype.unfreeze = function () {
    this.context._queue.push({
      op: "worksheetFreezeUnfreeze",
      id: this._id,
      freezePanesId: this._id,
      worksheetId: this._worksheet._id,
    });
  };

  WorksheetFreezePanes.prototype.toJSON = function () {
    return {};
  };

  function PageLayout(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet;
    this._scalarProperties = PAGE_LAYOUT_PROPERTIES.slice();
    this._navigationProperties = [];
    context._queue.push({
      op: "getWorksheetPageLayout",
      id: this._id,
      worksheetId: worksheet._id,
    });
  }
  PageLayout.prototype = Object.create(ClientObject.prototype);
  PageLayout.prototype.constructor = PageLayout;

  PAGE_LAYOUT_PROPERTIES.forEach(function (name) {
    defineScalarProperty(PageLayout.prototype, name);
  });

  PageLayout.prototype.set = function (source, options) {
    if (source === null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
    var properties = source;
    if (source instanceof ClientObject) {
      if (Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) {
        throw invalid("The object passed to set must have the same type.");
      }
      if (source.context !== this.context) throw invalidContext();
      properties = source.toJSON();
    } else if (!isPlainObject(source)) {
      throw new TypeError("set requires a plain property object");
    }
    if (own(properties, "headersFooters") && properties.headersFooters !== undefined) {
      throw unsupported("PageLayout.headersFooters is not supported by this Office.js host");
    }
    // `options` exists in the pinned overload. The scalar PageLayout surface
    // has no read-only members, so there is no option-dependent branch here.
    void options;
    PAGE_LAYOUT_PROPERTIES.forEach(function (name) {
      if (own(properties, name) && properties[name] !== undefined) {
        this[name] = properties[name];
      }
    }, this);
  };

  PageLayout.prototype.toJSON = function () {
    var result = {};
    PAGE_LAYOUT_PROPERTIES.forEach(function (name) {
      if (this._loaded[name]) result[name] = this["_" + name];
    }, this);
    return result;
  };

  Object.defineProperty(PageLayout.prototype, "headersFooters", {
    configurable: true,
    get: function () {
      throw unsupported("PageLayout.headersFooters is not supported by this Office.js host");
    },
  });

  function newRangeAreas(context, worksheet) {
    if (typeof officeJs.createRangeAreas !== "function" || typeof Excel.RangeAreas !== "function") {
      throw unsupported("PageLayout print-area methods require the RangeAreas adapter");
    }
    return officeJs.createRangeAreas(context, worksheet);
  }

  function printAreaResult(pageLayout, orNullObject) {
    var result = newRangeAreas(pageLayout.context, pageLayout._worksheet);
    pageLayout.context._queue.push({
      op: "pageLayoutGetPrintArea",
      id: result._id,
      pageLayoutId: pageLayout._id,
      worksheetId: pageLayout._worksheet._id,
      orNullObject: orNullObject === true,
    });
    return result;
  }

  PageLayout.prototype.getPrintArea = function () {
    return printAreaResult(this, false);
  };

  PageLayout.prototype.getPrintAreaOrNullObject = function () {
    return printAreaResult(this, true);
  };

  function titleResult(pageLayout, axis, orNullObject) {
    var range = new Excel.Range(pageLayout.context, pageLayout._worksheet, null);
    defineNullableRange(range);
    pageLayout.context._queue.push({
      op: axis === "rows" ? "pageLayoutGetPrintTitleRows" : "pageLayoutGetPrintTitleColumns",
      id: range._id,
      pageLayoutId: pageLayout._id,
      worksheetId: pageLayout._worksheet._id,
      orNullObject: orNullObject === true,
    });
    return range;
  }

  PageLayout.prototype.getPrintTitleColumns = function () {
    return titleResult(this, "columns", false);
  };

  PageLayout.prototype.getPrintTitleColumnsOrNullObject = function () {
    return titleResult(this, "columns", true);
  };

  PageLayout.prototype.getPrintTitleRows = function () {
    return titleResult(this, "rows", false);
  };

  PageLayout.prototype.getPrintTitleRowsOrNullObject = function () {
    return titleResult(this, "rows", true);
  };

  PageLayout.prototype.setPrintArea = function (printArea) {
    var operation = {
      op: "pageLayoutSetPrintArea",
      id: this._id,
      pageLayoutId: this._id,
      worksheetId: this._worksheet._id,
    };
    if (printArea instanceof Excel.Range) {
      requireSameContext(printArea, this.context);
      operation.rangeId = printArea._id;
    } else if (typeof Excel.RangeAreas === "function" && printArea instanceof Excel.RangeAreas) {
      requireSameContext(printArea, this.context);
      operation.rangeAreasId = printArea._id;
    } else if (typeof printArea === "string") {
      if (printArea.trim() === "") {
        throw invalid("PageLayout.setPrintArea requires a range address");
      }
      operation.address = printArea;
    } else {
      throw invalid("PageLayout.setPrintArea requires a Range, RangeAreas, or string");
    }
    this.context._queue.push(operation);
  };

  PageLayout.prototype.setPrintMargins = function (unit, marginOptions) {
    requireEnum(unit, "PageLayout.setPrintMargins unit", PRINT_MARGIN_UNITS);
    if (!isPlainObject(marginOptions)) {
      throw invalid("PageLayout.setPrintMargins marginOptions must be an object");
    }
    Object.keys(marginOptions).forEach(function (name) {
      if (MARGIN_PROPERTIES.indexOf(name) < 0) {
        throw invalid("Unsupported PageLayout margin property '" + name + "'");
      }
      requireNonNegativeNumber(
        marginOptions[name],
        "PageLayout.setPrintMargins." + name,
        false
      );
    });
    this.context._queue.push({
      op: "pageLayoutSetPrintMargins",
      id: this._id,
      pageLayoutId: this._id,
      worksheetId: this._worksheet._id,
      unit: unit,
      options: marginOptions,
    });
  };

  function queuePrintTitle(pageLayout, axis, value) {
    var operation = {
      op: axis === "rows" ? "pageLayoutSetPrintTitleRows" : "pageLayoutSetPrintTitleColumns",
      id: pageLayout._id,
      pageLayoutId: pageLayout._id,
      worksheetId: pageLayout._worksheet._id,
    };
    if (value instanceof Excel.Range) {
      requireSameContext(value, pageLayout.context);
      operation.rangeId = value._id;
    } else if (typeof value === "string") {
      if (value.trim() === "") {
        throw invalid("PageLayout print-title methods require a range address");
      }
      operation.address = value;
    } else {
      throw invalid("PageLayout print-title methods require a Range or string");
    }
    pageLayout.context._queue.push(operation);
  }

  PageLayout.prototype.setPrintTitleColumns = function (value) {
    queuePrintTitle(this, "columns", value);
  };

  PageLayout.prototype.setPrintTitleRows = function (value) {
    queuePrintTitle(this, "rows", value);
  };

  // Worksheet properties are additive to the lifecycle adapter. Keep the
  // extra names on the shared scalar list so `$all` and normal load options
  // reach the host's Worksheet projection.
  officeJs.addScalarProperties(Excel.Worksheet.prototype, [
    "showGridlines",
    "showHeadings",
    "tabColor",
  ]);
  officeJs.addNavigationProperties(Excel.Worksheet.prototype, [
    "freezePanes",
    "pageLayout",
  ]);
  ["showGridlines", "showHeadings", "tabColor"].forEach(function (name) {
    defineWorksheetScalarProperty(Excel.Worksheet.prototype, name);
  });

  Object.defineProperty(Excel.Worksheet.prototype, "freezePanes", {
    configurable: true,
    get: function () {
      if (!this._freezePanes) {
        this._freezePanes = new WorksheetFreezePanes(this.context, this);
      }
      return this._freezePanes;
    },
  });

  Object.defineProperty(Excel.Worksheet.prototype, "pageLayout", {
    configurable: true,
    get: function () {
      if (!this._pageLayout) {
        this._pageLayout = new PageLayout(this.context, this);
      }
      return this._pageLayout;
    },
  });

  // The lifecycle adapter owns the base Worksheet.toJSON implementation.
  // Extend it so loaded view properties survive serialization without
  // replacing the lifecycle fields or inventing unloaded values.
  var worksheetToJSON = Excel.Worksheet.prototype.toJSON;
  Excel.Worksheet.prototype.toJSON = function () {
    var result = worksheetToJSON ? worksheetToJSON.call(this) : {};
    ["showGridlines", "showHeadings", "tabColor"].forEach(function (name) {
      if (this._loaded[name]) result[name] = this["_" + name];
    }, this);
    return result;
  };

  Excel.WorksheetFreezePanes = WorksheetFreezePanes;
  Excel.PageLayout = PageLayout;
})(globalThis);
