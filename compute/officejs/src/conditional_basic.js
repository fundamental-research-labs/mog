(function (global) {
  "use strict";

  // The conditional-format implementation is intentionally split into this
  // module and the scale-family module.  This file owns the collection, the
  // common ConditionalFormat object, traditional rule families, and the
  // shared range-format hierarchy.  The scale module registers richer
  // constructors for colorScale, dataBar, and iconSet through the registry
  // below.
  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var hooks = global.__mogOfficeJs || {};
  var configureCollection = hooks.configureCollection;
  var createClientResult = hooks.createClientResult;

  function richApiError(code, message) {
    var error = new OfficeExtension.Error({ code: code, message: message });
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

  function unsupported(message) {
    return richApiError("ApiNotFound", message);
  }

  function invalidContext() {
    return invalid("The object belongs to a different request context.");
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
    if (!isPlainObject(value)) throw invalid(property + " must be an object");
    return value;
  }

  function readLoaded(object, name) {
    if (!object._loaded[name]) throw propertyNotLoaded(name);
    return name === "id" ? object._idValue : object["_" + name];
  }

  function queueScalar(object, name, value, wireValue) {
    object["_" + name] = value;
    object._loaded[name] = true;
    object.context._queue.push({
      op: "set",
      id: object._id,
      property: name,
      value: wireValue === undefined ? value : wireValue,
    });
  }

  function defineScalar(proto, name, normalizer, readOnly) {
    Object.defineProperty(proto, name, {
      get: function () {
        return readLoaded(this, name);
      },
      set: readOnly
        ? undefined
        : function (value) {
            var normalized = normalizer
              ? normalizer.call(this, value)
              : value;
            queueScalar(this, name, normalized);
          },
      configurable: true,
    });
  }

  function navigationProperties(object) {
    var names = (object._navigationProperties || []).slice();
    (object._additionalNavigationProperties || []).forEach(function (name) {
      if (names.indexOf(name) < 0) names.push(name);
    });
    return names;
  }

  function objectProperties(source, target, options) {
    if (source instanceof ClientObject) {
      if (source.context !== target.context) throw invalidContext();
      if (Object.getPrototypeOf(source) !== Object.getPrototypeOf(target)) {
        throw invalid("The object passed to set must have the same type.");
      }
      source = source.toJSON();
    } else if (!isPlainObject(source)) {
      throw new TypeError("set requires a property object");
    }

    var suppressReadOnly = options && options.throwOnReadOnly === false;
    var scalarNames = target._scalarProperties || [];
    var navNames = navigationProperties(target);
    Object.keys(source).forEach(function (name) {
      if (scalarNames.indexOf(name) < 0 && navNames.indexOf(name) < 0) {
        throw invalid("Unsupported " + target._objectName + " property '" + name + "'");
      }
      if ((name === "id" || name === "type") && !suppressReadOnly) {
        throw invalid(target._objectName + "." + name + " is read-only");
      }
    });
    scalarNames.forEach(function (name) {
      if (!own(source, name) || source[name] === undefined) return;
      if (name === "id" || name === "type") {
        if (!suppressReadOnly) {
          throw invalid(target._objectName + "." + name + " is read-only");
        }
        return;
      }
      target[name] = source[name];
    });
    navNames.forEach(function (name) {
      if (!own(source, name) || source[name] === undefined) return;
      target[name].set(source[name], options);
    });
    return target;
  }

  function toJSONObject() {
    var result = {};
    (this._scalarProperties || []).forEach(function (name) {
      if (this._loaded[name]) {
        result[name] = name === "id" ? this._idValue : this["_" + name];
      }
    }, this);
    (this._children || []).forEach(function (name) {
      var child = this["_" + name];
      if (child === undefined && this._childCache) child = this._childCache[name];
      if (child !== undefined) result[name] = child.toJSON();
    }, this);
    return result;
  }

  function queueChildBinding(object, root, kind, orNullObject, side) {
    object.context._queue.push({
      op: "conditionalFormatChild",
      id: object._id,
      parentId: root._id,
      kind: kind,
      orNullObject: !!orNullObject,
      side: side === undefined ? undefined : side,
    });
  }

  function rootConditionalFormat(object) {
    if (object instanceof ConditionalFormat) return object;
    if (object._conditionalFormat) return object._conditionalFormat;
    if (object._parent) return rootConditionalFormat(object._parent);
    throw invalid("The conditional-format child has no parent format");
  }

  function rootWorksheet(object) {
    var format = rootConditionalFormat(object);
    return format._worksheet;
  }

  function makeClientResult(context) {
    if (typeof createClientResult === "function") return createClientResult(context);
    return new OfficeExtension.ClientResult(context);
  }

  function normalizeString(value, property, allowEmpty) {
    if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
      throw invalid(property + " must be " + (allowEmpty ? "a string" : "a non-empty string"));
    }
    return value;
  }

  function normalizeInteger(value, property, min) {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
      throw invalid(property + " must be an integer");
    }
    if (min !== undefined && value < min) {
      throw invalid(property + " must be at least " + min);
    }
    return value;
  }

  var cellOperators = {
    Between: "between",
    NotBetween: "notBetween",
    EqualTo: "equal",
    NotEqualTo: "notEqual",
    GreaterThan: "greaterThan",
    LessThan: "lessThan",
    GreaterThanOrEqual: "greaterThanOrEqual",
    LessThanOrEqual: "lessThanOrEqual",
  };

  var textOperators = {
    Contains: "containsText",
    NotContains: "notContains",
    BeginsWith: "beginsWith",
    EndsWith: "endsWith",
  };

  var topBottomTypes = {
    TopItems: { percent: false, bottom: false },
    TopPercent: { percent: true, bottom: false },
    BottomItems: { percent: false, bottom: true },
    BottomPercent: { percent: true, bottom: true },
  };

  var presetCriteria = [
    "Blanks",
    "NonBlanks",
    "Errors",
    "NonErrors",
    "Yesterday",
    "Today",
    "Tomorrow",
    "LastSevenDays",
    "LastWeek",
    "ThisWeek",
    "NextWeek",
    "LastMonth",
    "ThisMonth",
    "NextMonth",
    "AboveAverage",
    "BelowAverage",
    "EqualOrAboveAverage",
    "EqualOrBelowAverage",
    "OneStdDevAboveAverage",
    "OneStdDevBelowAverage",
    "TwoStdDevAboveAverage",
    "TwoStdDevBelowAverage",
    "ThreeStdDevAboveAverage",
    "ThreeStdDevBelowAverage",
    "UniqueValues",
    "DuplicateValues",
  ];

  var timePeriods = {
    Yesterday: "yesterday",
    Today: "today",
    Tomorrow: "tomorrow",
    LastSevenDays: "last7Days",
    LastWeek: "lastWeek",
    ThisWeek: "thisWeek",
    NextWeek: "nextWeek",
    LastMonth: "lastMonth",
    ThisMonth: "thisMonth",
    NextMonth: "nextMonth",
  };

  function assertOnly(source, allowed, property) {
    Object.keys(source).forEach(function (name) {
      if (allowed.indexOf(name) < 0) {
        throw invalid("Unsupported " + property + " property '" + name + "'");
      }
    });
  }

  function normalizeCellValueRule(value) {
    var source = requirePlainObject(value, "ConditionalFormat.cellValue.rule");
    assertOnly(source, ["formula1", "formula2", "operator"], "ConditionalFormat.cellValue.rule");
    if (!own(source, "formula1")) {
      throw invalid("ConditionalFormat.cellValue.rule requires formula1");
    }
    if (!own(source, "operator") || !own(cellOperators, source.operator)) {
      throw invalid("ConditionalFormat.cellValue.rule.operator must be a supported enum value");
    }
    var between = source.operator === "Between" || source.operator === "NotBetween";
    if (between && !own(source, "formula2")) {
      throw invalid(source.operator + " requires formula2");
    }
    if (!between && own(source, "formula2")) {
      throw invalid("formula2 is only valid with Between or NotBetween operators");
    }
    var result = {
      operator: source.operator,
      formula1: normalizeString(source.formula1, "ConditionalFormat.cellValue.rule.formula1", true),
    };
    if (own(source, "formula2")) {
      result.formula2 = normalizeString(source.formula2, "ConditionalFormat.cellValue.rule.formula2", true);
    }
    return {
      display: result,
      wire: {
        operator: cellOperators[source.operator],
        value1: result.formula1,
        ...(own(result, "formula2") ? { value2: result.formula2 } : {}),
      },
    };
  }

  function normalizeTextRule(value) {
    var source = requirePlainObject(value, "ConditionalFormat.textComparison.rule");
    assertOnly(source, ["operator", "text"], "ConditionalFormat.textComparison.rule");
    if (!own(source, "operator") || !own(textOperators, source.operator)) {
      throw invalid("ConditionalFormat.textComparison.rule.operator must be a supported enum value");
    }
    return {
      display: {
        operator: source.operator,
        text: normalizeString(source.text, "ConditionalFormat.textComparison.rule.text", true),
      },
      wire: {
        operator: textOperators[source.operator],
        text: source.text,
      },
    };
  }

  function normalizeTopBottomRule(value) {
    var source = requirePlainObject(value, "ConditionalFormat.topBottom.rule");
    assertOnly(source, ["rank", "type"], "ConditionalFormat.topBottom.rule");
    if (!own(source, "rank") || !own(source, "type")) {
      throw invalid("ConditionalFormat.topBottom.rule requires rank and type");
    }
    if (!own(topBottomTypes, source.type)) {
      throw invalid("ConditionalFormat.topBottom.rule.type must be a supported enum value");
    }
    var kind = topBottomTypes[source.type];
    var rank = normalizeInteger(source.rank, "ConditionalFormat.topBottom.rule.rank", 1);
    if (kind.percent && rank > 100) {
      throw invalid("Percent top/bottom rank must be between 1 and 100");
    }
    if (!kind.percent && rank > 1000) {
      throw invalid("Item top/bottom rank must be between 1 and 1000");
    }
    return {
      display: { rank: rank, type: source.type },
      wire: { type: "top10", rank: rank, percent: kind.percent, bottom: kind.bottom },
    };
  }

  function normalizePresetRule(value) {
    var source = requirePlainObject(value, "ConditionalFormat.preset.rule");
    assertOnly(source, ["criterion"], "ConditionalFormat.preset.rule");
    if (!own(source, "criterion") || presetCriteria.indexOf(source.criterion) < 0) {
      throw invalid("ConditionalFormat.preset.rule.criterion must be a supported enum value");
    }
    var criterion = source.criterion;
    var wire;
    if (criterion === "Blanks" || criterion === "NonBlanks") {
      wire = { type: "containsBlanks", blanks: criterion === "Blanks" };
    } else if (criterion === "Errors" || criterion === "NonErrors") {
      wire = { type: "containsErrors", errors: criterion === "Errors" };
    } else if (criterion === "UniqueValues" || criterion === "DuplicateValues") {
      wire = { type: "duplicateValues", unique: criterion === "UniqueValues" };
    } else if (timePeriods[criterion]) {
      wire = { type: "timePeriod", timePeriod: timePeriods[criterion] };
    } else {
      var above = criterion.indexOf("Above") >= 0;
      var below = criterion.indexOf("Below") >= 0;
      var equal = criterion.indexOf("EqualOr") === 0;
      var stdDev = 0;
      if (criterion.indexOf("OneStdDev") === 0) stdDev = 1;
      if (criterion.indexOf("TwoStdDev") === 0) stdDev = 2;
      if (criterion.indexOf("ThreeStdDev") === 0) stdDev = 3;
      wire = {
        type: "aboveAverage",
        aboveAverage: above || !below,
        equalAverage: equal,
      };
      if (stdDev) wire.stdDev = stdDev;
    }
    return { display: { criterion: criterion }, wire: wire };
  }

  function normalizeCustomFormula(value) {
    return normalizeString(value, "ConditionalFormat.custom.rule.formula", true);
  }

  function normalizeOfficeType(type) {
    var allowed = [
      "Custom",
      "DataBar",
      "ColorScale",
      "IconSet",
      "TopBottom",
      "PresetCriteria",
      "ContainsText",
      "CellValue",
    ];
    if (typeof type !== "string" || allowed.indexOf(type) < 0) {
      throw invalid("ConditionalFormatCollection.add type must be a supported enum value");
    }
    return type;
  }

  function canonicalRuleForChild(kind, value) {
    if (kind === "cellValue") return normalizeCellValueRule(value);
    if (kind === "textComparison") return normalizeTextRule(value);
    if (kind === "topBottom") return normalizeTopBottomRule(value);
    if (kind === "preset") return normalizePresetRule(value);
    throw invalid("The conditional-format child '" + kind + "' has no assignable rule");
  }

  function ruleDisplayForChild(kind, value) {
    if (kind === "cellValue") return normalizeCellValueRule(value).display;
    if (kind === "textComparison") return normalizeTextRule(value).display;
    if (kind === "topBottom") return normalizeTopBottomRule(value).display;
    if (kind === "preset") return normalizePresetRule(value).display;
    return value;
  }

  function normalizeRangeSide(value) {
    var map = {
      EdgeTop: "top",
      EdgeBottom: "bottom",
      EdgeLeft: "left",
      EdgeRight: "right",
      top: "top",
      bottom: "bottom",
      left: "left",
      right: "right",
    };
    if (typeof value !== "string" || !own(map, value)) {
      throw invalid("ConditionalRangeBorderIndex must be EdgeTop, EdgeBottom, EdgeLeft, or EdgeRight");
    }
    return map[value] === "top"
      ? "EdgeTop"
      : map[value] === "bottom"
        ? "EdgeBottom"
        : map[value] === "left"
          ? "EdgeLeft"
          : "EdgeRight";
  }

  var underlineValues = ["None", "Single", "Double"];
  var borderStyleValues = ["None", "Continuous", "Dash", "DashDot", "DashDotDot", "Dot"];

  function normalizeColor(value, property) {
    return normalizeString(value, property, true);
  }

  function normalizeBorderStyle(value) {
    if (typeof value !== "string" || borderStyleValues.indexOf(value) < 0) {
      throw invalid("ConditionalRangeBorder.style must be a supported enum value");
    }
    return value;
  }

  function normalizeUnderline(value) {
    if (typeof value !== "string" || underlineValues.indexOf(value) < 0) {
      throw invalid("ConditionalRangeFont.underline must be a supported enum value");
    }
    return value;
  }

  function normalizeBool(value, property) {
    if (typeof value !== "boolean") throw invalid(property + " must be a boolean");
    return value;
  }

  function styleSet(object, name, value, normalizer) {
    var normalized = normalizer ? normalizer(value) : value;
    queueScalar(object, name, normalized);
  }

  function ConditionalFormatCollection(context, range) {
    ClientObject.call(this, context);
    this._range = range;
    this._worksheet = range._worksheet;
    this._rangeId = range._id;
    this._objectName = "ConditionalFormatCollection";
    this._scalarProperties = ["items"];
    this._children = [];
    if (typeof configureCollection === "function") {
      configureCollection(this, function (key, descriptor) {
        var item = new ConditionalFormat(this.context, this, String(key), null, true);
        var properties = descriptor && descriptor.properties;
        if (properties && properties.type !== undefined) item._typeHint = properties.type;
        return item;
      });
    }
    this.context._queue.push({
      op: "getConditionalFormatCollection",
      id: this._id,
      rangeId: range._id,
    });
  }
  ConditionalFormatCollection.prototype = Object.create(ClientObject.prototype);
  ConditionalFormatCollection.prototype.constructor = ConditionalFormatCollection;
  ConditionalFormatCollection.prototype.toJSON = function () {
    var result = {};
    if (this._loaded.items) {
      result.items = this._items.map(function (item) { return item.toJSON(); });
    }
    return result;
  };
  ConditionalFormatCollection.prototype.add = function (type) {
    type = normalizeOfficeType(type);
    var item = new ConditionalFormat(this.context, this, null, type, true);
    this.context._queue.push({
      op: "conditionalFormatCollectionAdd",
      id: item._id,
      collectionId: this._id,
      type: type,
    });
    return item;
  };
  ConditionalFormatCollection.prototype.clearAll = function () {
    this.context._queue.push({ op: "conditionalFormatCollectionClearAll", collectionId: this._id });
  };
  ConditionalFormatCollection.prototype.getCount = function () {
    var result = makeClientResult(this.context);
    this.context._queue.push({
      op: "conditionalFormatCollectionGetCount",
      collectionId: this._id,
      resultId: result._id,
    });
    return result;
  };
  ConditionalFormatCollection.prototype.getItem = function (id) {
    id = normalizeString(id, "ConditionalFormatCollection.getItem id", true);
    var item = new ConditionalFormat(this.context, this, id, null, true);
    this.context._queue.push({
      op: "conditionalFormatCollectionGetItem",
      id: item._id,
      collectionId: this._id,
      key: id,
      byIndex: false,
      orNullObject: false,
    });
    return item;
  };
  ConditionalFormatCollection.prototype.getItemAt = function (index) {
    index = normalizeInteger(index, "ConditionalFormatCollection.getItemAt index", 0);
    var item = new ConditionalFormat(this.context, this, String(index), null, true);
    this.context._queue.push({
      op: "conditionalFormatCollectionGetItem",
      id: item._id,
      collectionId: this._id,
      key: String(index),
      byIndex: true,
      orNullObject: false,
    });
    return item;
  };
  ConditionalFormatCollection.prototype.getItemOrNullObject = function (id) {
    id = normalizeString(id, "ConditionalFormatCollection.getItemOrNullObject id", true);
    var item = new ConditionalFormat(this.context, this, id, null, true);
    this.context._queue.push({
      op: "conditionalFormatCollectionGetItem",
      id: item._id,
      collectionId: this._id,
      key: id,
      byIndex: false,
      orNullObject: true,
    });
    return item;
  };

  function ConditionalFormat(context, collection, idHint, typeHint, skipBind) {
    ClientObject.call(this, context);
    this._collection = collection;
    this._worksheet = collection._worksheet;
    this._idHint = idHint;
    this._typeHint = typeHint;
    this._objectName = "ConditionalFormat";
    this._scalarProperties = ["id", "priority", "stopIfTrue", "type"];
    this._navigationProperties = [
      "cellValue",
      "cellValueOrNullObject",
      "colorScale",
      "colorScaleOrNullObject",
      "custom",
      "customOrNullObject",
      "dataBar",
      "dataBarOrNullObject",
      "iconSet",
      "iconSetOrNullObject",
      "preset",
      "presetOrNullObject",
      "textComparison",
      "textComparisonOrNullObject",
      "topBottom",
      "topBottomOrNullObject",
    ];
    this._children = this._navigationProperties.slice();
    this._childCache = Object.create(null);
    if (!skipBind && idHint !== null && idHint !== undefined) {
      this.context._queue.push({
        op: "conditionalFormatCollectionGetItem",
        id: this._id,
        collectionId: collection._id,
        key: String(idHint),
        byIndex: false,
        orNullObject: false,
      });
    }
  }
  ConditionalFormat.prototype = Object.create(ClientObject.prototype);
  ConditionalFormat.prototype.constructor = ConditionalFormat;
  defineScalar(ConditionalFormat.prototype, "priority", function (value) {
    if (typeof value !== "number" || !isFinite(value) || Math.floor(value) !== value) {
      throw invalid("ConditionalFormat.priority must be an integer");
    }
    return value;
  });
  defineScalar(ConditionalFormat.prototype, "stopIfTrue", function (value) {
    return normalizeBool(value, "ConditionalFormat.stopIfTrue");
  });
  defineScalar(ConditionalFormat.prototype, "id", null, true);
  defineScalar(ConditionalFormat.prototype, "type", null, true);
  ConditionalFormat.prototype.set = function (source, options) {
    return objectProperties(source, this, options);
  };
  ConditionalFormat.prototype.toJSON = toJSONObject;
  ConditionalFormat.prototype.delete = function () {
    this.context._queue.push({ op: "conditionalFormatDelete", id: this._id });
  };
  ConditionalFormat.prototype.getRange = function () {
    var range = new Excel.Range(this.context, this._worksheet, null);
    this.context._queue.push({
      op: "conditionalFormatGetRange",
      id: this._id,
      rangeId: range._id,
      orNullObject: false,
    });
    return range;
  };
  ConditionalFormat.prototype.getRangeOrNullObject = function () {
    var range = new Excel.Range(this.context, this._worksheet, null);
    this.context._queue.push({
      op: "conditionalFormatGetRange",
      id: this._id,
      rangeId: range._id,
      orNullObject: true,
    });
    return range;
  };
  ConditionalFormat.prototype.getRanges = function () {
    throw unsupported(
      "ConditionalFormat.getRanges is unavailable because RangeAreas is not implemented by this host"
    );
  };
  ConditionalFormat.prototype.setRanges = function (ranges) {
    var value;
    if (ranges instanceof Excel.Range) {
      if (ranges.context !== this.context) throw invalidContext();
      if (ranges._worksheet !== this._worksheet) {
        throw invalid("ConditionalFormat.setRanges requires a range on the same worksheet");
      }
      value = [{ rangeId: ranges._id }];
    } else if (typeof ranges === "string") {
      if (ranges.length === 0) throw invalid("ConditionalFormat.setRanges requires a non-empty range");
      value = [{ address: ranges }];
    } else {
      throw unsupported(
        "ConditionalFormat.setRanges only supports Range or address string because RangeAreas is not implemented by this host"
      );
    }
    this.context._queue.push({ op: "conditionalFormatSetRanges", id: this._id, ranges: value });
  };

  function queueRuleChange(object, type, rule) {
    object.context._queue.push({
      op: "conditionalFormatChangeRule",
      id: object._id,
      type: type,
      rule: rule === undefined ? null : rule,
    });
  }
  ConditionalFormat.prototype.changeRuleToCellValue = function (properties) {
    queueRuleChange(this, "CellValue", normalizeCellValueRule(properties).wire);
  };
  ConditionalFormat.prototype.changeRuleToColorScale = function () {
    queueRuleChange(this, "ColorScale", null);
  };
  ConditionalFormat.prototype.changeRuleToContainsText = function (properties) {
    queueRuleChange(this, "ContainsText", normalizeTextRule(properties).wire);
  };
  ConditionalFormat.prototype.changeRuleToCustom = function (formula) {
    queueRuleChange(this, "Custom", { type: "formula", formula: normalizeCustomFormula(formula) });
  };
  ConditionalFormat.prototype.changeRuleToDataBar = function () {
    queueRuleChange(this, "DataBar", null);
  };
  ConditionalFormat.prototype.changeRuleToIconSet = function () {
    queueRuleChange(this, "IconSet", null);
  };
  ConditionalFormat.prototype.changeRuleToPresetCriteria = function (properties) {
    queueRuleChange(this, "PresetCriteria", normalizePresetRule(properties).wire);
  };
  ConditionalFormat.prototype.changeRuleToTopBottom = function (properties) {
    queueRuleChange(this, "TopBottom", normalizeTopBottomRule(properties).wire);
  };

  var conditionalRegistry = global.__mogConditionalFormats || {};
  conditionalRegistry.factories = conditionalRegistry.factories || Object.create(null);
  conditionalRegistry.registerChild = function (kind, factory) {
    if (typeof kind !== "string" || typeof factory !== "function") {
      throw new TypeError("registerChild requires a child kind and factory");
    }
    conditionalRegistry.factories[kind] = factory;
  };
  conditionalRegistry.getFactory = function (kind) {
    return conditionalRegistry.factories[kind];
  };
  global.__mogConditionalFormats = conditionalRegistry;

  function makeTypedChild(format, name, kind, orNullObject) {
    var cacheName = name + (orNullObject ? "OrNullObject" : "");
    if (format._childCache[cacheName]) return format._childCache[cacheName];
    var factory = conditionalRegistry.getFactory(kind);
    var child;
    if (factory) {
      child = factory(format.context, format, !!orNullObject);
    } else if (
      (kind === "colorScale" || kind === "dataBar" || kind === "iconSet") &&
      typeof hooks.createConditionalFormatChild === "function"
    ) {
      // Keep compatibility with the scale-family adapter while it migrates
      // to the shared registry. New scale adapters should register a factory
      // so the parent proxy ID can be used for add-before-sync object paths.
      child = hooks.createConditionalFormatChild(
        format.context,
        format,
        kind,
        format._idHint,
        null
      );
    } else {
      child = new ConditionalScalePlaceholder(format.context, format, kind, !!orNullObject);
    }
    if (!(child instanceof ClientObject) || child.context !== format.context) {
      throw invalidContext();
    }
    format._childCache[cacheName] = child;
    return child;
  }

  [
    ["cellValue", "cellValue", false],
    ["cellValueOrNullObject", "cellValue", true],
    ["colorScale", "colorScale", false],
    ["colorScaleOrNullObject", "colorScale", true],
    ["custom", "custom", false],
    ["customOrNullObject", "custom", true],
    ["dataBar", "dataBar", false],
    ["dataBarOrNullObject", "dataBar", true],
    ["iconSet", "iconSet", false],
    ["iconSetOrNullObject", "iconSet", true],
    ["preset", "preset", false],
    ["presetOrNullObject", "preset", true],
    ["textComparison", "textComparison", false],
    ["textComparisonOrNullObject", "textComparison", true],
    ["topBottom", "topBottom", false],
    ["topBottomOrNullObject", "topBottom", true],
  ].forEach(function (entry) {
    Object.defineProperty(ConditionalFormat.prototype, entry[0], {
      get: function () {
        return makeTypedChild(this, entry[0], entry[1], entry[2]);
      },
      configurable: true,
    });
  });

  function ConditionalChild(context, parent, kind, orNullObject, scalarRule) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._conditionalFormat = rootConditionalFormat(parent);
    this._objectName = kind === "textComparison" ? "TextConditionalFormat" : kind + " conditional format";
    this._kind = kind;
    this._scalarProperties = scalarRule ? ["rule"] : [];
    this._navigationProperties = ["format"];
    this._children = ["format"];
    this._childCache = Object.create(null);
    if (kind === "custom") {
      this._navigationProperties.push("rule");
      this._children.push("rule");
    }
    queueChildBinding(this, this._conditionalFormat, kind, orNullObject);
  }
  ConditionalChild.prototype = Object.create(ClientObject.prototype);
  ConditionalChild.prototype.constructor = ConditionalChild;
  ConditionalChild.prototype.load = function (props) {
    // An omitted load on these objects loads the rule and the format object,
    // matching Office's generated proxy behavior for this small surface.
    if (props === undefined) {
      if (this._kind === "custom") return ClientObject.prototype.load.call(this, ["format", "rule"]);
      if (this._scalarProperties.length) return ClientObject.prototype.load.call(this, ["rule", "format"]);
    }
    return ClientObject.prototype.load.call(this, props);
  };
  ConditionalChild.prototype.set = function (source, options) {
    return objectProperties(source, this, options);
  };
  ConditionalChild.prototype.toJSON = toJSONObject;
  Object.defineProperty(ConditionalChild.prototype, "format", {
    get: function () {
      if (!this._childCache.format) {
        this._childCache.format = new ConditionalRangeFormat(this.context, this);
      }
      return this._childCache.format;
    },
    configurable: true,
  });

  function assignRule(child, value) {
    var normalized = canonicalRuleForChild(child._kind, value);
    queueScalar(child, "rule", normalized.display, normalized.wire);
  }

  [
    ["CellValueConditionalFormat", "cellValue"],
    ["TextConditionalFormat", "textComparison"],
    ["TopBottomConditionalFormat", "topBottom"],
    ["PresetCriteriaConditionalFormat", "preset"],
  ].forEach(function (entry) {
    var ctor = function (context, parent, orNullObject) {
      ConditionalChild.call(this, context, parent, entry[1], orNullObject, true);
    };
    ctor.prototype = Object.create(ConditionalChild.prototype);
    ctor.prototype.constructor = ctor;
    Object.defineProperty(ctor.prototype, "rule", {
      get: function () {
        return readLoaded(this, "rule");
      },
      set: function (value) {
        assignRule(this, value);
      },
      configurable: true,
    });
    Excel[entry[0]] = ctor;
    conditionalRegistry.registerChild(entry[1], function (context, parent, orNullObject) {
      return new ctor(context, parent, orNullObject);
    });
  });

  function CustomConditionalFormat(context, parent, orNullObject) {
    ConditionalChild.call(this, context, parent, "custom", orNullObject, false);
  }
  CustomConditionalFormat.prototype = Object.create(ConditionalChild.prototype);
  CustomConditionalFormat.prototype.constructor = CustomConditionalFormat;
  Object.defineProperty(CustomConditionalFormat.prototype, "rule", {
    get: function () {
      if (!this._childCache.rule) {
        this._childCache.rule = new ConditionalFormatRule(this.context, this);
      }
      return this._childCache.rule;
    },
    configurable: true,
  });
  Excel.CustomConditionalFormat = CustomConditionalFormat;
  conditionalRegistry.registerChild("custom", function (context, parent, orNullObject) {
    return new CustomConditionalFormat(context, parent, orNullObject);
  });

  function ConditionalFormatRule(context, parent) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._conditionalFormat = rootConditionalFormat(parent);
    this._objectName = "ConditionalFormatRule";
    this._scalarProperties = ["formula", "formulaLocal", "formulaR1C1"];
    this._children = [];
    queueChildBinding(this, this._conditionalFormat, "rule", false);
  }
  ConditionalFormatRule.prototype = Object.create(ClientObject.prototype);
  ConditionalFormatRule.prototype.constructor = ConditionalFormatRule;
  ["formula", "formulaLocal", "formulaR1C1"].forEach(function (name) {
    defineScalar(ConditionalFormatRule.prototype, name, function (value) {
      return normalizeString(value, "ConditionalFormatRule." + name, true);
    });
  });
  ConditionalFormatRule.prototype.set = function (source, options) {
    return objectProperties(source, this, options);
  };
  ConditionalFormatRule.prototype.toJSON = toJSONObject;
  Excel.ConditionalFormatRule = ConditionalFormatRule;

  function ConditionalScalePlaceholder(context, parent, kind, orNullObject) {
    ConditionalChild.call(this, context, parent, kind, orNullObject, false);
  }
  ConditionalScalePlaceholder.prototype = Object.create(ConditionalChild.prototype);
  ConditionalScalePlaceholder.prototype.constructor = ConditionalScalePlaceholder;

  function ConditionalRangeFormat(context, parent) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._conditionalFormat = rootConditionalFormat(parent);
    this._objectName = "ConditionalRangeFormat";
    this._scalarProperties = ["numberFormat"];
    this._navigationProperties = ["borders", "fill", "font"];
    this._children = ["borders", "fill", "font"];
    this._childCache = Object.create(null);
    queueChildBinding(this, this._conditionalFormat, "format", false);
  }
  ConditionalRangeFormat.prototype = Object.create(ClientObject.prototype);
  ConditionalRangeFormat.prototype.constructor = ConditionalRangeFormat;
  defineScalar(ConditionalRangeFormat.prototype, "numberFormat", null, false);
  ConditionalRangeFormat.prototype.set = function (source, options) {
    if (source instanceof ClientObject) {
      if (source.context !== this.context || Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) {
        throw invalid("The object passed to set must have the same type and request context.");
      }
      source = source.toJSON();
    }
    requirePlainObject(source, "ConditionalRangeFormat");
    var borders = source.borders;
    var scalarAndChildren = {};
    Object.keys(source).forEach(function (name) {
      if (name !== "borders") scalarAndChildren[name] = source[name];
    });
    objectProperties(scalarAndChildren, this, options);
    if (borders !== undefined) {
      requirePlainObject(borders, "ConditionalRangeFormat.borders");
      Object.keys(borders).forEach(function (name) {
        if (["top", "bottom", "left", "right"].indexOf(name) < 0) {
          throw invalid("Unsupported ConditionalRangeFormat.borders property '" + name + "'");
        }
        if (borders[name] !== undefined) this.borders[name].set(borders[name], options);
      }, this);
    }
    return this;
  };
  ConditionalRangeFormat.prototype.toJSON = toJSONObject;
  ConditionalRangeFormat.prototype.clearFormat = function () {
    this.context._queue.push({ op: "set", id: this._id, property: "clearFormat", value: null });
  };
  Object.defineProperty(ConditionalRangeFormat.prototype, "font", {
    get: function () {
      if (!this._childCache.font) this._childCache.font = new ConditionalRangeFont(this.context, this);
      return this._childCache.font;
    },
    configurable: true,
  });
  Object.defineProperty(ConditionalRangeFormat.prototype, "fill", {
    get: function () {
      if (!this._childCache.fill) this._childCache.fill = new ConditionalRangeFill(this.context, this);
      return this._childCache.fill;
    },
    configurable: true,
  });
  Object.defineProperty(ConditionalRangeFormat.prototype, "borders", {
    get: function () {
      if (!this._childCache.borders) this._childCache.borders = new ConditionalRangeBorderCollection(this.context, this);
      return this._childCache.borders;
    },
    configurable: true,
  });

  function ConditionalRangeFont(context, parent) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._conditionalFormat = rootConditionalFormat(parent);
    this._objectName = "ConditionalRangeFont";
    this._scalarProperties = ["bold", "color", "italic", "strikethrough", "underline"];
    this._children = [];
    queueChildBinding(this, this._conditionalFormat, "font", false);
  }
  ConditionalRangeFont.prototype = Object.create(ClientObject.prototype);
  ConditionalRangeFont.prototype.constructor = ConditionalRangeFont;
  defineScalar(ConditionalRangeFont.prototype, "bold", function (value) { return normalizeBool(value, "ConditionalRangeFont.bold"); });
  defineScalar(ConditionalRangeFont.prototype, "color", function (value) { return normalizeColor(value, "ConditionalRangeFont.color"); });
  defineScalar(ConditionalRangeFont.prototype, "italic", function (value) { return normalizeBool(value, "ConditionalRangeFont.italic"); });
  defineScalar(ConditionalRangeFont.prototype, "strikethrough", function (value) { return normalizeBool(value, "ConditionalRangeFont.strikethrough"); });
  defineScalar(ConditionalRangeFont.prototype, "underline", normalizeUnderline);
  ConditionalRangeFont.prototype.set = function (source, options) { return objectProperties(source, this, options); };
  ConditionalRangeFont.prototype.toJSON = toJSONObject;
  ConditionalRangeFont.prototype.clear = function () {
    this.context._queue.push({ op: "set", id: this._id, property: "clear", value: null });
  };

  function ConditionalRangeFill(context, parent) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._conditionalFormat = rootConditionalFormat(parent);
    this._objectName = "ConditionalRangeFill";
    this._scalarProperties = ["color"];
    this._children = [];
    queueChildBinding(this, this._conditionalFormat, "fill", false);
  }
  ConditionalRangeFill.prototype = Object.create(ClientObject.prototype);
  ConditionalRangeFill.prototype.constructor = ConditionalRangeFill;
  defineScalar(ConditionalRangeFill.prototype, "color", function (value) { return normalizeColor(value, "ConditionalRangeFill.color"); });
  ConditionalRangeFill.prototype.set = function (source, options) { return objectProperties(source, this, options); };
  ConditionalRangeFill.prototype.toJSON = toJSONObject;
  ConditionalRangeFill.prototype.clear = function () {
    this.context._queue.push({ op: "set", id: this._id, property: "clear", value: null });
  };

  var borderSides = ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight"];
  var borderSideProperties = {
    EdgeTop: "top",
    EdgeBottom: "bottom",
    EdgeLeft: "left",
    EdgeRight: "right",
  };

  function ConditionalRangeBorderCollection(context, parent) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._conditionalFormat = rootConditionalFormat(parent);
    this._objectName = "ConditionalRangeBorderCollection";
    this._scalarProperties = ["items", "count"];
    this._children = [];
    this._childCache = Object.create(null);
    if (typeof configureCollection === "function") {
      configureCollection(this, function (key, descriptor) {
        var side = normalizeRangeSide(String(key));
        var item = new ConditionalRangeBorder(this.context, this, side, true);
        var properties = descriptor && descriptor.properties;
        if (properties) {
          Object.keys(properties).forEach(function (name) {
            if (hooks.hydrateProperty) hooks.hydrateProperty(item, name, properties[name]);
            else {
              item._loaded[name] = true;
              item[name === "id" ? "_idValue" : "_" + name] = properties[name];
            }
          });
        }
        this._childCache[side] = item;
        this._childCache[borderSideProperties[side]] = item;
        return item;
      });
    }
    queueChildBinding(this, this._conditionalFormat, "borderCollection", false);
  }
  ConditionalRangeBorderCollection.prototype = Object.create(ClientObject.prototype);
  ConditionalRangeBorderCollection.prototype.constructor = ConditionalRangeBorderCollection;
  ConditionalRangeBorderCollection.prototype.toJSON = function () {
    var result = {};
    if (this._loaded.items) result.items = this._items.map(function (item) { return item.toJSON(); });
    if (this._loaded.count) result.count = this._count;
    return result;
  };
  ConditionalRangeBorderCollection.prototype._getBorder = function (side) {
    side = normalizeRangeSide(side);
    var name = borderSideProperties[side];
    if (!this._childCache[name]) {
      this._childCache[name] = new ConditionalRangeBorder(this.context, this, side, false);
    }
    return this._childCache[name];
  };
  ["top", "bottom", "left", "right"].forEach(function (name) {
    Object.defineProperty(ConditionalRangeBorderCollection.prototype, name, {
      get: function () { return this._getBorder(name === "top" ? "EdgeTop" : name === "bottom" ? "EdgeBottom" : name === "left" ? "EdgeLeft" : "EdgeRight"); },
      configurable: true,
    });
  });
  Object.defineProperty(ConditionalRangeBorderCollection.prototype, "count", {
    get: function () { return readLoaded(this, "count"); },
    configurable: true,
  });
  ConditionalRangeBorderCollection.prototype.getItem = function (index) {
    return this._getBorder(index);
  };
  ConditionalRangeBorderCollection.prototype.getItemAt = function (index) {
    index = normalizeInteger(index, "ConditionalRangeBorderCollection.getItemAt index", 0);
    if (index >= borderSides.length) throw invalid("ConditionalRangeBorderCollection index is out of range");
    return this._getBorder(borderSides[index]);
  };
  function ConditionalRangeBorder(context, parent, side, skipBind) {
    ClientObject.call(this, context);
    this._parent = parent;
    this._conditionalFormat = rootConditionalFormat(parent);
    this._side = side;
    this._objectName = "ConditionalRangeBorder";
    this._scalarProperties = ["color", "sideIndex", "style"];
    this._children = [];
    if (!skipBind) queueChildBinding(this, this._conditionalFormat, "border", false, side);
  }
  ConditionalRangeBorder.prototype = Object.create(ClientObject.prototype);
  ConditionalRangeBorder.prototype.constructor = ConditionalRangeBorder;
  defineScalar(ConditionalRangeBorder.prototype, "color", function (value) { return normalizeColor(value, "ConditionalRangeBorder.color"); });
  defineScalar(ConditionalRangeBorder.prototype, "sideIndex", null, true);
  defineScalar(ConditionalRangeBorder.prototype, "style", normalizeBorderStyle);
  ConditionalRangeBorder.prototype.set = function (source, options) {
    if (source instanceof ClientObject) {
      if (source.context !== this.context || Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) throw invalidContext();
      source = source.toJSON();
    }
    requirePlainObject(source, "ConditionalRangeBorder");
    Object.keys(source).forEach(function (name) {
      if (["color", "style", "sideIndex"].indexOf(name) < 0) throw invalid("Unsupported ConditionalRangeBorder property '" + name + "'");
      if (name === "sideIndex") throw invalid("ConditionalRangeBorder.sideIndex is read-only");
    });
    if (own(source, "color") && source.color !== undefined) this.color = source.color;
    if (own(source, "style") && source.style !== undefined) this.style = source.style;
    return this;
  };
  ConditionalRangeBorder.prototype.toJSON = toJSONObject;

  Excel.ConditionalFormatCollection = ConditionalFormatCollection;
  Excel.ConditionalFormat = ConditionalFormat;
  Excel.ConditionalRangeFormat = ConditionalRangeFormat;
  Excel.ConditionalRangeFont = ConditionalRangeFont;
  Excel.ConditionalRangeFill = ConditionalRangeFill;
  Excel.ConditionalRangeBorderCollection = ConditionalRangeBorderCollection;
  Excel.ConditionalRangeBorder = ConditionalRangeBorder;

  Object.defineProperty(Excel.Range.prototype, "conditionalFormats", {
    get: function () {
      if (!this._conditionalFormats) {
        this._conditionalFormats = new ConditionalFormatCollection(this.context, this);
      }
      return this._conditionalFormats;
    },
    configurable: true,
  });
  if (hooks.addNavigationProperties) {
    hooks.addNavigationProperties(Excel.Range.prototype, ["conditionalFormats"]);
  } else {
    Excel.Range.prototype._navigationProperties = Excel.Range.prototype._navigationProperties || [];
    if (Excel.Range.prototype._navigationProperties.indexOf("conditionalFormats") < 0) {
      Excel.Range.prototype._navigationProperties.push("conditionalFormats");
    }
  }

  // Expose helpers for the scale-family adapter without making it depend on
  // implementation details such as the operation queue format.
  conditionalRegistry.ConditionalChild = ConditionalChild;
  conditionalRegistry.ConditionalRangeFormat = ConditionalRangeFormat;
  conditionalRegistry.rootConditionalFormat = rootConditionalFormat;
  conditionalRegistry.queueChildBinding = queueChildBinding;
  conditionalRegistry.toJSONObject = toJSONObject;
})(globalThis);
