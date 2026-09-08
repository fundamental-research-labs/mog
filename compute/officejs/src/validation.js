(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

  function richApiError(code, message) {
    var error = new global.OfficeExtension.Error({
      code: code,
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = code;
    return error;
  }

  function propertyNotLoaded(name) {
    return richApiError(
      "PropertyNotLoaded",
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
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

  function createRangeAreas(context, worksheet) {
    if (officeJs && typeof officeJs.createRangeAreas === "function") {
      return officeJs.createRangeAreas(context, worksheet || null);
    }
    if (typeof Excel.RangeAreas !== "function") {
      throw unsupported(
        "DataValidation.getInvalidCells requires the RangeAreas adapter"
      );
    }
    return new Excel.RangeAreas(context, worksheet || null);
  }

  function queueRangeAreasOperation(result, operation) {
    if (
      officeJs &&
      typeof officeJs.queueRangeAreasOperation === "function"
    ) {
      return officeJs.queueRangeAreasOperation(result, operation);
    }
    operation.id = result._id;
    result.context._queue.push(operation);
    return result;
  }

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function isPlainObject(value) {
    if (!isObject(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function own(object, name) {
    return Object.prototype.hasOwnProperty.call(object, name);
  }

  function requirePlainObject(value, property) {
    if (!isPlainObject(value)) {
      throw invalid(property + " must be an object");
    }
    return value;
  }

  function normalizeFormula(value, context, property, allowDate) {
    if (value instanceof Excel.Range) {
      if (value.context !== context) throw invalidContext();
      if (value._address == null || value._address === "") {
        throw invalid(property + " cannot use an unbounded Range");
      }
      return "=" + value._address;
    }
    if (value instanceof Date) {
      if (!allowDate) {
        throw invalid(property + " must be a number, Range, or formula string");
      }
      if (isNaN(value.getTime())) throw invalid(property + " must be a valid date");
      return value.toISOString();
    }
    if (typeof value === "number") {
      if (!isFinite(value)) throw invalid(property + " must be finite");
      return value;
    }
    if (typeof value === "string") {
      if (value.length === 0) throw invalid(property + " cannot be empty");
      return value;
    }
    var allowed = allowDate
      ? "a Date, Range, or formula string"
      : "a number, Range, or formula string";
    throw invalid(property + " must be " + allowed);
  }

  var validationKinds = [
    "wholeNumber",
    "decimal",
    "date",
    "time",
    "textLength",
    "list",
    "custom",
  ];

  var operators = [
    "Between",
    "NotBetween",
    "EqualTo",
    "NotEqualTo",
    "GreaterThan",
    "LessThan",
    "GreaterThanOrEqualTo",
    "LessThanOrEqualTo",
  ];

  function normalizeBasicRule(value, context, kind) {
    var source = requirePlainObject(value, "DataValidation.rule." + kind);
    Object.keys(source).forEach(function (key) {
      if (key !== "formula1" && key !== "formula2" && key !== "operator") {
        throw invalid(
          "Unsupported DataValidation.rule." + kind + " property '" + key + "'"
        );
      }
    });
    if (!own(source, "formula1")) {
      throw invalid("DataValidation.rule." + kind + " requires formula1");
    }
    if (!own(source, "operator") || operators.indexOf(source.operator) < 0) {
      throw invalid(
        "DataValidation.rule." + kind + ".operator must be a supported enum value"
      );
    }
    var output = {
      formula1: normalizeFormula(
        source.formula1,
        context,
        "DataValidation.rule." + kind + ".formula1",
        kind === "date" || kind === "time"
      ),
      operator: source.operator,
    };
    if (own(source, "formula2")) {
      if (
        source.operator !== "Between" &&
        source.operator !== "NotBetween"
      ) {
        throw invalid(
          "formula2 is only valid with Between or NotBetween operators"
        );
      }
      output.formula2 = normalizeFormula(
        source.formula2,
        context,
        "DataValidation.rule." + kind + ".formula2",
        kind === "date" || kind === "time"
      );
    } else if (
      source.operator === "Between" ||
      source.operator === "NotBetween"
    ) {
      throw invalid(source.operator + " requires formula2");
    }
    return output;
  }

  function normalizeListRule(value, context) {
    var source = requirePlainObject(value, "DataValidation.rule.list");
    Object.keys(source).forEach(function (key) {
      if (key !== "source" && key !== "inCellDropDown") {
        throw invalid(
          "Unsupported DataValidation.rule.list property '" + key + "'"
        );
      }
    });
    if (!own(source, "source")) {
      throw invalid("DataValidation.rule.list requires source");
    }
    var list = source.source;
    if (list instanceof Excel.Range) {
      list = normalizeFormula(
        list,
        context,
        "DataValidation.rule.list.source",
        false
      );
    } else if (typeof list !== "string" || list.length === 0) {
      throw invalid("DataValidation.rule.list.source must be a non-empty string or Range");
    }
    if (!own(source, "inCellDropDown") || typeof source.inCellDropDown !== "boolean") {
      throw invalid(
        "DataValidation.rule.list.inCellDropDown must be a boolean"
      );
    }
    return {
      source: list,
      inCellDropDown: source.inCellDropDown,
    };
  }

  function normalizeRule(value, context) {
    var source = requirePlainObject(value, "DataValidation.rule");
    var keys = Object.keys(source);
    if (keys.length === 0) return {};
    if (keys.length !== 1) {
      throw invalid("DataValidation.rule must contain exactly one validation type");
    }
    var kind = keys[0];
    if (validationKinds.indexOf(kind) < 0) {
      throw invalid("Unsupported DataValidation.rule property '" + kind + "'");
    }
    var normalized;
    if (kind === "list") normalized = normalizeListRule(source[kind], context);
    else if (kind === "custom") {
      var custom = requirePlainObject(source[kind], "DataValidation.rule.custom");
      Object.keys(custom).forEach(function (key) {
        if (key !== "formula") {
          throw invalid(
            "Unsupported DataValidation.rule.custom property '" + key + "'"
          );
        }
      });
      if (typeof custom.formula !== "string" || custom.formula.length === 0) {
        throw invalid("DataValidation.rule.custom.formula must be a non-empty string");
      }
      normalized = { formula: custom.formula };
    } else {
      normalized = normalizeBasicRule(source[kind], context, kind);
    }
    var result = {};
    result[kind] = normalized;
    return result;
  }

  function normalizeErrorAlert(value) {
    var source = requirePlainObject(value, "DataValidation.errorAlert");
    ["message", "showAlert", "style", "title"].forEach(function (key) {
      if (!own(source, key)) {
        throw invalid("DataValidation.errorAlert requires " + key);
      }
    });
    Object.keys(source).forEach(function (key) {
      if (["message", "showAlert", "style", "title"].indexOf(key) < 0) {
        throw invalid(
          "Unsupported DataValidation.errorAlert property '" + key + "'"
        );
      }
    });
    if (typeof source.message !== "string") {
      throw invalid("DataValidation.errorAlert.message must be a string");
    }
    if (typeof source.title !== "string") {
      throw invalid("DataValidation.errorAlert.title must be a string");
    }
    if (typeof source.showAlert !== "boolean") {
      throw invalid("DataValidation.errorAlert.showAlert must be a boolean");
    }
    if (["Stop", "Warning", "Information"].indexOf(source.style) < 0) {
      throw invalid("DataValidation.errorAlert.style must be a supported enum value");
    }
    return {
      message: source.message,
      showAlert: source.showAlert,
      style: source.style,
      title: source.title,
    };
  }

  function normalizePrompt(value) {
    var source = requirePlainObject(value, "DataValidation.prompt");
    ["message", "showPrompt", "title"].forEach(function (key) {
      if (!own(source, key)) {
        throw invalid("DataValidation.prompt requires " + key);
      }
    });
    Object.keys(source).forEach(function (key) {
      if (["message", "showPrompt", "title"].indexOf(key) < 0) {
        throw invalid("Unsupported DataValidation.prompt property '" + key + "'");
      }
    });
    if (typeof source.message !== "string") {
      throw invalid("DataValidation.prompt.message must be a string");
    }
    if (typeof source.title !== "string") {
      throw invalid("DataValidation.prompt.title must be a string");
    }
    if (typeof source.showPrompt !== "boolean") {
      throw invalid("DataValidation.prompt.showPrompt must be a boolean");
    }
    return {
      message: source.message,
      showPrompt: source.showPrompt,
      title: source.title,
    };
  }

  function normalizeScalar(name, value, context) {
    switch (name) {
      case "rule":
        return normalizeRule(value, context);
      case "errorAlert":
        return normalizeErrorAlert(value);
      case "ignoreBlanks":
        if (typeof value !== "boolean") {
          throw invalid("DataValidation.ignoreBlanks must be a boolean");
        }
        return value;
      case "prompt":
        return normalizePrompt(value);
      default:
        return value;
    }
  }

  function queueScalar(object, name, value) {
    object["_" + name] = value;
    object._loaded[name] = true;
    object.context._queue.push({
      op: "set",
      id: object._id,
      property: name,
      value: value,
    });
  }

  function setProperties(source) {
    var isClientObject = source instanceof ClientObject;
    if (isClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalid("The object passed to set must have the same type");
      }
      if (source.context !== this.context) throw invalidContext();
      var loaded = {};
      for (var k = 0; k < this._scalarProperties.length; k++) {
        var loadedName = this._scalarProperties[k];
        if (source._loaded[loadedName]) {
          loaded[loadedName] = source["_" + loadedName];
        }
      }
      source = loaded;
    } else if (!isPlainObject(source)) {
      throw new TypeError("set requires a property object");
    }
    var names = this._scalarProperties;
    Object.keys(source).forEach(function (name) {
      if (names.indexOf(name) < 0) {
        throw invalid("Unsupported DataValidation property '" + name + "'");
      }
      if (name === "type" || name === "valid") {
        throw invalid("DataValidation." + name + " is read-only");
      }
    });
    var normalized = {};
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (!own(source, name) || source[name] === undefined) continue;
      normalized[name] = normalizeScalar(name, source[name], this.context);
    }
    for (var j = 0; j < names.length; j++) {
      var property = names[j];
      if (own(normalized, property)) queueScalar(this, property, normalized[property]);
    }
  }

  function toJSON() {
    var result = {};
    for (var i = 0; i < this._scalarProperties.length; i++) {
      var name = this._scalarProperties[i];
      if (this._loaded[name]) result[name] = this["_" + name];
    }
    return result;
  }

  function defineScalar(proto, name, normalizer) {
    Object.defineProperty(proto, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        var normalized = normalizer ? normalizer.call(this, value) : value;
        queueScalar(this, name, normalized);
      },
    });
  }

  function DataValidation(context, range) {
    ClientObject.call(this, context);
    this._range = range;
    this._rangeId = range._id;
    this._scalarProperties = [
      "rule",
      "errorAlert",
      "ignoreBlanks",
      "prompt",
      "type",
      "valid",
    ];
    this._navigationProperties = [];
    this.context._queue.push({
      op: "getRangeDataValidation",
      id: this._id,
      rangeId: range._id,
    });
  }
  DataValidation.prototype = Object.create(ClientObject.prototype);
  DataValidation.prototype.constructor = DataValidation;

  defineScalar(DataValidation.prototype, "rule", function (value) {
    return normalizeRule(value, this.context);
  });
  defineScalar(DataValidation.prototype, "errorAlert", function (value) {
    return normalizeErrorAlert(value);
  });
  defineScalar(DataValidation.prototype, "ignoreBlanks", function (value) {
    if (typeof value !== "boolean") {
      throw invalid("DataValidation.ignoreBlanks must be a boolean");
    }
    return value;
  });
  defineScalar(DataValidation.prototype, "prompt", function (value) {
    return normalizePrompt(value);
  });
  ["type", "valid"].forEach(function (name) {
    Object.defineProperty(DataValidation.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  });

  DataValidation.prototype.set = setProperties;
  DataValidation.prototype.toJSON = toJSON;
  DataValidation.prototype.clear = function () {
    this.context._queue.push({
      op: "set",
      id: this._id,
      property: "clear",
      value: null,
    });
  };
  DataValidation.prototype.getInvalidCells = function () {
    var result = createRangeAreas(this.context, this._range._worksheet);
    return queueRangeAreasOperation(result, {
      op: "dataValidationGetInvalidCells",
      validationId: this._id,
      rangeId: this._rangeId,
      orNullObject: false,
    });
  };
  DataValidation.prototype.getInvalidCellsOrNullObject = function () {
    var result = createRangeAreas(this.context, this._range._worksheet);
    return queueRangeAreasOperation(result, {
      op: "dataValidationGetInvalidCells",
      validationId: this._id,
      rangeId: this._rangeId,
      orNullObject: true,
    });
  };

  Object.defineProperty(Excel.Range.prototype, "dataValidation", {
    get: function () {
      if (!this._dataValidation) {
        this._dataValidation = new DataValidation(this.context, this);
      }
      return this._dataValidation;
    },
  });

  // Newer bootstrap revisions expose declarative navigation hooks. Keep the
  // fallback for the current bootstrap so this module remains loadable during
  // the transition, while allowing the foundation to own the canonical list.
  var hooks = global.__mogOfficeJs;
  if (hooks && hooks.addNavigationProperties) {
    hooks.addNavigationProperties(Excel.Range.prototype, ["dataValidation"]);
  } else {
    Excel.Range.prototype._navigationProperties =
      Excel.Range.prototype._navigationProperties || [];
    if (Excel.Range.prototype._navigationProperties.indexOf("dataValidation") < 0) {
      Excel.Range.prototype._navigationProperties.push("dataValidation");
    }
  }

  Excel.DataValidation = DataValidation;
})(globalThis);
