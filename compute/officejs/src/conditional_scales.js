(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs || {};

  function invalid(message) {
    var error = new OfficeExtension.Error({ code: "InvalidArgument", message: message });
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

  function invalidContext() {
    var error = new OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
    error.name = "RichApi.Error";
    error.code = "InvalidRequestContext";
    return error;
  }

  function own(object, name) {
    return Object.prototype.hasOwnProperty.call(object, name);
  }

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function isPlainObject(value) {
    if (!isObject(value) || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function requireObject(value, property) {
    if (!isPlainObject(value)) throw invalid(property + " must be an object");
    return value;
  }

  function requireSetObject(value, property) {
    if (!isObject(value) || Array.isArray(value)) {
      throw new TypeError(property + " requires a property object");
    }
    return value;
  }

  function checkKeys(value, allowed, property) {
    Object.keys(value).forEach(function (name) {
      if (allowed.indexOf(name) < 0) {
        throw invalid("Unsupported " + property + " property '" + name + "'");
      }
    });
  }

  function requireString(value, property, allowEmpty) {
    if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
      throw invalid(property + " must be " + (allowEmpty ? "a string" : "a non-empty string"));
    }
    return value;
  }

  function requireBoolean(value, property) {
    if (typeof value !== "boolean") throw invalid(property + " must be a boolean");
    return value;
  }

  function requireInteger(value, property) {
    if (
      typeof value !== "number" ||
      !isFinite(value) ||
      Math.floor(value) !== value ||
      value < 0
    ) {
      throw invalid(property + " must be a non-negative integer");
    }
    return value;
  }

  var COLOR_TYPES = [
    "Invalid",
    "LowestValue",
    "HighestValue",
    "Number",
    "Percent",
    "Formula",
    "Percentile",
  ];
  var BAR_TYPES = [
    "Invalid",
    "Automatic",
    "LowestValue",
    "HighestValue",
    "Number",
    "Percent",
    "Formula",
    "Percentile",
  ];
  var ICON_TYPES = ["Invalid", "Number", "Percent", "Formula", "Percentile"];
  var ICON_OPERATORS = ["Invalid", "GreaterThan", "GreaterThanOrEqual"];
  var AXIS_FORMATS = ["Automatic", "None", "CellMidPoint"];
  var BAR_DIRECTIONS = ["Context", "LeftToRight", "RightToLeft"];
  var ICON_STYLES = [
    "Invalid",
    "ThreeArrows",
    "ThreeArrowsGray",
    "ThreeFlags",
    "ThreeTrafficLights1",
    "ThreeTrafficLights2",
    "ThreeSigns",
    "ThreeSymbols",
    "ThreeSymbols2",
    "FourArrows",
    "FourArrowsGray",
    "FourRedToBlack",
    "FourRating",
    "FourTrafficLights",
    "FiveArrows",
    "FiveArrowsGray",
    "FiveRating",
    "FiveQuarters",
    "ThreeStars",
    "ThreeTriangles",
    "FiveBoxes",
  ];

  function enumValue(value, property, allowed) {
    if (typeof value !== "string" || allowed.indexOf(value) < 0) {
      throw invalid(
        property +
          " must be one of " +
          allowed.join(", ") +
          "; received " +
          String(value)
      );
    }
    return value;
  }

  function normalizeColorCriterion(value, property) {
    var source = requireObject(value, property);
    checkKeys(source, ["color", "formula", "type"], property);
    var type = enumValue(source.type, property + ".type", COLOR_TYPES);
    var result = { type: type, formula: null };
    if (own(source, "color")) {
      result.color = requireString(source.color, property + ".color", false);
    }
    if (own(source, "formula") && source.formula !== null && source.formula !== undefined) {
      result.formula = requireString(source.formula, property + ".formula", false);
    } else if (type !== "LowestValue" && type !== "HighestValue") {
      throw invalid(property + ".formula is required for type " + type);
    }
    if (
      (type === "LowestValue" || type === "HighestValue") &&
      result.formula !== null
    ) {
      throw invalid(property + ".formula must be null for type " + type);
    }
    return result;
  }

  function normalizeColorCriteria(value, property) {
    var source = requireObject(value, property);
    checkKeys(source, ["minimum", "midpoint", "maximum"], property);
    if (!own(source, "minimum")) throw invalid(property + ".minimum is required");
    if (!own(source, "maximum")) throw invalid(property + ".maximum is required");
    var result = {
      minimum: normalizeColorCriterion(source.minimum, property + ".minimum"),
      maximum: normalizeColorCriterion(source.maximum, property + ".maximum"),
    };
    if (own(source, "midpoint") && source.midpoint !== null && source.midpoint !== undefined) {
      result.midpoint = normalizeColorCriterion(source.midpoint, property + ".midpoint");
    }
    return result;
  }

  function normalizeBoundRule(value, property) {
    var source = requireObject(value, property);
    checkKeys(source, ["formula", "type"], property);
    var type = enumValue(source.type, property + ".type", BAR_TYPES);
    var formula = null;
    if (own(source, "formula") && source.formula !== null && source.formula !== undefined) {
      formula = requireString(source.formula, property + ".formula", false);
    }
    if (
      formula === null &&
      type !== "Automatic" &&
      type !== "LowestValue" &&
      type !== "HighestValue"
    ) {
      throw invalid(property + ".formula is required for type " + type);
    }
    if (
      formula !== null &&
      (type === "Automatic" || type === "LowestValue" || type === "HighestValue")
    ) {
      throw invalid(property + ".formula must be null for type " + type);
    }
    return { type: type, formula: formula };
  }

  function normalizeIcon(value, property) {
    if (value === null || value === undefined) return null;
    var source = requireObject(value, property);
    checkKeys(source, ["index", "set"], property);
    if (!own(source, "set")) throw invalid(property + ".set is required");
    if (!own(source, "index")) throw invalid(property + ".index is required");
    return {
      set: enumValue(source.set, property + ".set", ICON_STYLES),
      index: requireInteger(source.index, property + ".index"),
    };
  }

  function normalizeIconCriterion(value, property) {
    var source = requireObject(value, property);
    checkKeys(source, ["customIcon", "formula", "operator", "type"], property);
    return {
      customIcon: own(source, "customIcon")
        ? normalizeIcon(source.customIcon, property + ".customIcon")
        : null,
      formula: requireString(source.formula, property + ".formula", false),
      operator: enumValue(source.operator, property + ".operator", ICON_OPERATORS),
      type: enumValue(source.type, property + ".type", ICON_TYPES),
    };
  }

  function normalizeIconCriteria(value, property) {
    if (!Array.isArray(value)) throw invalid(property + " must be an array");
    if (value.length < 2 || value.length > 5) {
      throw invalid(property + " must contain between two and five criteria");
    }
    return value.map(function (entry, index) {
      return normalizeIconCriterion(entry, property + "[" + index + "]");
    });
  }

  function resolveFormatId(owner, explicit) {
    if (explicit !== undefined && explicit !== null && String(explicit) !== "") {
      return String(explicit);
    }
    if (!owner) return null;
    var candidates = [
      owner._formatId,
      owner._conditionalFormatId,
      owner._idValue,
      owner._key,
      owner._formatKey,
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] !== undefined && candidates[i] !== null && String(candidates[i]) !== "") {
        return String(candidates[i]);
      }
    }
    return null;
  }

  function resolveRuleId(owner, explicit) {
    if (explicit !== undefined && explicit !== null && String(explicit) !== "") {
      return String(explicit);
    }
    if (owner && owner._ruleId !== undefined && owner._ruleId !== null) {
      return String(owner._ruleId);
    }
    return null;
  }

  function resolveWorksheetId(owner) {
    if (!owner) return null;
    if (owner._worksheet && owner._worksheet._id) return owner._worksheet._id;
    if (owner._worksheetId !== undefined && owner._worksheetId !== null) {
      return String(owner._worksheetId);
    }
    if (owner._sheetId !== undefined && owner._sheetId !== null) {
      return String(owner._sheetId);
    }
    // Nested data-bar format objects are owned by the visual child.  The
    // worksheet binding lives on the ConditionalFormat parent, so carry it
    // through the client object ownership chain instead of emitting a child
    // request that the host cannot resolve.
    if (owner._owner) return resolveWorksheetId(owner._owner);
    return null;
  }

  function queueChild(object, owner, explicitFormatId, explicitRuleId, kind) {
    object._owner = owner || null;
    object._formatId = resolveFormatId(owner, explicitFormatId);
    object._ruleId = resolveRuleId(owner, explicitRuleId);
    object._kind = kind;

    var operation = {
      op: "getConditionalFormatChild",
      id: object._id,
      kind: kind,
    };
    if (object._formatId !== null) operation.formatId = object._formatId;
    if (object._ruleId !== null) operation.ruleId = object._ruleId;
    var worksheetId = resolveWorksheetId(owner);
    if (worksheetId !== null) operation.worksheetId = worksheetId;
    object.context._queue.push(operation);
  }

  function VisualConditionalFormat(context, owner, formatId, ruleId, kind) {
    ClientObject.call(this, context);
    queueChild(this, owner, formatId, ruleId, kind);
  }
  VisualConditionalFormat.prototype = Object.create(ClientObject.prototype);
  VisualConditionalFormat.prototype.constructor = VisualConditionalFormat;

  function defineScalar(ctor, name, normalizer) {
    Object.defineProperty(ctor.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      set: function (value) {
        var normalized = normalizer ? normalizer(value, name) : value;
        this["_" + name] = normalized;
        this._loaded[name] = true;
        this.context._queue.push({
          op: "set",
          id: this._id,
          property: name,
          value: normalized,
        });
      },
      configurable: true,
    });
  }

  function defineReadonly(ctor, name) {
    Object.defineProperty(ctor.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      configurable: true,
    });
  }

  function setProperties(source, options, propertyNames, readonlyNames) {
    requireSetObject(source, this.constructor && this.constructor.name
      ? this.constructor.name + ".set"
      : "set");
    var isClientObject = source instanceof ClientObject;
    if (isClientObject && source.context !== this.context) throw invalidContext();
    var properties = isClientObject ? source.toJSON() : source;
    if (isClientObject && Object.getPrototypeOf(source) !== Object.getPrototypeOf(this)) {
      throw invalid("The object passed to set must have the same type.");
    }
    checkKeys(properties, propertyNames.concat(readonlyNames || []), this._kind + " conditional format");
    (readonlyNames || []).forEach(function (name) {
      if (!own(properties, name) || properties[name] === undefined) return;
      if (!options || options.throwOnReadOnly !== false) {
        throw invalid("The property '" + name + "' is read-only.");
      }
    });
    propertyNames.forEach(function (name) {
      if (!own(properties, name) || properties[name] === undefined) return;
      if (this._navigationProperties.indexOf(name) >= 0) {
        var child = isClientObject ? source[name] : properties[name];
        this[name].set(child, options);
      } else {
        this[name] = properties[name];
      }
    }, this);
    return this;
  }

  function visualToJSON() {
    var data = {};
    (this._scalarProperties || []).forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    (this._navigationProperties || []).forEach(function (name) {
      var child = this["_" + name];
      if (child && typeof child.toJSON === "function") data[name] = child.toJSON();
    }, this);
    return data;
  }

  function DataBarConditionalFormat(context, owner, formatId, ruleId) {
    VisualConditionalFormat.call(this, context, owner, formatId, ruleId, "dataBar");
    this._scalarProperties = [
      "axisColor",
      "axisFormat",
      "barDirection",
      "lowerBoundRule",
      "showDataBarOnly",
      "upperBoundRule",
    ];
    this._navigationProperties = ["negativeFormat", "positiveFormat"];
  }
  DataBarConditionalFormat.prototype = Object.create(VisualConditionalFormat.prototype);
  DataBarConditionalFormat.prototype.constructor = DataBarConditionalFormat;
  DataBarConditionalFormat.prototype.set = function (properties, options) {
    return setProperties.call(
      this,
      properties,
      options,
      [
        "axisColor",
        "axisFormat",
        "barDirection",
        "lowerBoundRule",
        "showDataBarOnly",
        "upperBoundRule",
        "negativeFormat",
        "positiveFormat",
      ],
      []
    );
  };
  DataBarConditionalFormat.prototype.toJSON = visualToJSON;
  defineScalar(DataBarConditionalFormat, "axisColor", function (value, property) {
    return requireString(value, property, true);
  });
  defineScalar(DataBarConditionalFormat, "axisFormat", function (value, property) {
    return enumValue(value, property, AXIS_FORMATS);
  });
  defineScalar(DataBarConditionalFormat, "barDirection", function (value, property) {
    return enumValue(value, property, BAR_DIRECTIONS);
  });
  defineScalar(DataBarConditionalFormat, "lowerBoundRule", normalizeBoundRule);
  defineScalar(DataBarConditionalFormat, "showDataBarOnly", requireBoolean);
  defineScalar(DataBarConditionalFormat, "upperBoundRule", normalizeBoundRule);

  Object.defineProperty(DataBarConditionalFormat.prototype, "negativeFormat", {
    get: function () {
      if (!this._negativeFormat) {
        this._negativeFormat = new ConditionalDataBarNegativeFormat(
          this.context,
          this,
          this._formatId,
          this._ruleId
        );
      }
      return this._negativeFormat;
    },
    configurable: true,
  });
  Object.defineProperty(DataBarConditionalFormat.prototype, "positiveFormat", {
    get: function () {
      if (!this._positiveFormat) {
        this._positiveFormat = new ConditionalDataBarPositiveFormat(
          this.context,
          this,
          this._formatId,
          this._ruleId
        );
      }
      return this._positiveFormat;
    },
    configurable: true,
  });

  function ConditionalDataBarPositiveFormat(context, owner, formatId, ruleId) {
    VisualConditionalFormat.call(
      this,
      context,
      owner,
      formatId,
      ruleId,
      "dataBarPositive"
    );
    this._scalarProperties = ["borderColor", "fillColor", "gradientFill"];
    this._navigationProperties = [];
  }
  ConditionalDataBarPositiveFormat.prototype = Object.create(VisualConditionalFormat.prototype);
  ConditionalDataBarPositiveFormat.prototype.constructor = ConditionalDataBarPositiveFormat;
  ConditionalDataBarPositiveFormat.prototype.set = function (properties, options) {
    return setProperties.call(
      this,
      properties,
      options,
      ["borderColor", "fillColor", "gradientFill"],
      []
    );
  };
  ConditionalDataBarPositiveFormat.prototype.toJSON = visualToJSON;
  defineScalar(ConditionalDataBarPositiveFormat, "borderColor", function (value, property) {
    return requireString(value, property, true);
  });
  defineScalar(ConditionalDataBarPositiveFormat, "fillColor", function (value, property) {
    return requireString(value, property, false);
  });
  defineScalar(ConditionalDataBarPositiveFormat, "gradientFill", requireBoolean);

  function ConditionalDataBarNegativeFormat(context, owner, formatId, ruleId) {
    VisualConditionalFormat.call(
      this,
      context,
      owner,
      formatId,
      ruleId,
      "dataBarNegative"
    );
    this._scalarProperties = [
      "borderColor",
      "fillColor",
      "matchPositiveBorderColor",
      "matchPositiveFillColor",
    ];
    this._navigationProperties = [];
  }
  ConditionalDataBarNegativeFormat.prototype = Object.create(VisualConditionalFormat.prototype);
  ConditionalDataBarNegativeFormat.prototype.constructor = ConditionalDataBarNegativeFormat;
  ConditionalDataBarNegativeFormat.prototype.set = function (properties, options) {
    return setProperties.call(
      this,
      properties,
      options,
      [
        "borderColor",
        "fillColor",
        "matchPositiveBorderColor",
        "matchPositiveFillColor",
      ],
      []
    );
  };
  ConditionalDataBarNegativeFormat.prototype.toJSON = visualToJSON;
  defineScalar(ConditionalDataBarNegativeFormat, "borderColor", function (value, property) {
    return requireString(value, property, true);
  });
  defineScalar(ConditionalDataBarNegativeFormat, "fillColor", function (value, property) {
    return requireString(value, property, true);
  });
  defineScalar(ConditionalDataBarNegativeFormat, "matchPositiveBorderColor", requireBoolean);
  defineScalar(ConditionalDataBarNegativeFormat, "matchPositiveFillColor", requireBoolean);

  function ColorScaleConditionalFormat(context, owner, formatId, ruleId) {
    VisualConditionalFormat.call(this, context, owner, formatId, ruleId, "colorScale");
    this._scalarProperties = ["criteria"];
    this._additionalScalarProperties = ["threeColorScale"];
    this._navigationProperties = [];
  }
  ColorScaleConditionalFormat.prototype = Object.create(VisualConditionalFormat.prototype);
  ColorScaleConditionalFormat.prototype.constructor = ColorScaleConditionalFormat;
  ColorScaleConditionalFormat.prototype.set = function (properties, options) {
    return setProperties.call(this, properties, options, ["criteria"], ["threeColorScale"]);
  };
  ColorScaleConditionalFormat.prototype.toJSON = visualToJSON;
  defineScalar(ColorScaleConditionalFormat, "criteria", function (value, property) {
    return normalizeColorCriteria(value, "ColorScaleConditionalFormat." + property);
  });
  defineReadonly(ColorScaleConditionalFormat, "threeColorScale");

  function IconSetConditionalFormat(context, owner, formatId, ruleId) {
    VisualConditionalFormat.call(this, context, owner, formatId, ruleId, "iconSet");
    this._scalarProperties = ["criteria", "reverseIconOrder", "showIconOnly", "style"];
    this._navigationProperties = [];
  }
  IconSetConditionalFormat.prototype = Object.create(VisualConditionalFormat.prototype);
  IconSetConditionalFormat.prototype.constructor = IconSetConditionalFormat;
  IconSetConditionalFormat.prototype.set = function (properties, options) {
    return setProperties.call(
      this,
      properties,
      options,
      ["criteria", "reverseIconOrder", "showIconOnly", "style"],
      []
    );
  };
  IconSetConditionalFormat.prototype.toJSON = visualToJSON;
  defineScalar(IconSetConditionalFormat, "criteria", function (value, property) {
    return normalizeIconCriteria(value, "IconSetConditionalFormat." + property);
  });
  defineScalar(IconSetConditionalFormat, "reverseIconOrder", requireBoolean);
  defineScalar(IconSetConditionalFormat, "showIconOnly", requireBoolean);
  defineScalar(IconSetConditionalFormat, "style", function (value, property) {
    return enumValue(value, property, ICON_STYLES);
  });

  function createChild(context, owner, kind, formatId, ruleId) {
    if (kind === "colorScale") return new ColorScaleConditionalFormat(context, owner, formatId, ruleId);
    if (kind === "dataBar") return new DataBarConditionalFormat(context, owner, formatId, ruleId);
    if (kind === "dataBarPositive") {
      return new ConditionalDataBarPositiveFormat(context, owner, formatId, ruleId);
    }
    if (kind === "dataBarNegative") {
      return new ConditionalDataBarNegativeFormat(context, owner, formatId, ruleId);
    }
    if (kind === "iconSet") return new IconSetConditionalFormat(context, owner, formatId, ruleId);
    throw invalid("Unsupported conditional-format visual kind '" + kind + "'");
  }

  // The base conditional-format adapter can use this factory to avoid
  // depending on constructor details. Direct constructors remain available
  // for Office.js-compatible object paths.
  officeJs.createConditionalFormatChild = createChild;
  officeJs.queueConditionalFormatChild = queueChild;
  officeJs.conditionalFormatVisualKinds = {
    colorScale: ColorScaleConditionalFormat,
    dataBar: DataBarConditionalFormat,
    dataBarPositive: ConditionalDataBarPositiveFormat,
    dataBarNegative: ConditionalDataBarNegativeFormat,
    iconSet: IconSetConditionalFormat,
  };

  // conditional_basic.js owns the common ConditionalFormat navigation
  // properties.  Register these factories when that module has already
  // installed its registry so `.colorScale`, `.dataBar`, and `.iconSet`
  // materialize the typed children rather than a placeholder.  Runtime setup
  // loads the base adapter before this file; the direct registry assignment
  // keeps the module safe for embedders that evaluate the files separately.
  var conditionalRegistry = global.__mogConditionalFormats;
  if (conditionalRegistry && typeof conditionalRegistry.registerChild === "function") {
    ["colorScale", "dataBar", "iconSet"].forEach(function (kind) {
      conditionalRegistry.registerChild(kind, function (context, parent, orNullObject) {
        return createChild(context, parent, undefined, undefined, kind);
      });
    });
  }

  Excel.DataBarConditionalFormat = DataBarConditionalFormat;
  Excel.ConditionalDataBarPositiveFormat = ConditionalDataBarPositiveFormat;
  Excel.ConditionalDataBarNegativeFormat = ConditionalDataBarNegativeFormat;
  Excel.ColorScaleConditionalFormat = ColorScaleConditionalFormat;
  Excel.IconSetConditionalFormat = IconSetConditionalFormat;
})(globalThis);
