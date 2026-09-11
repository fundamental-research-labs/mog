(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

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

  function invalidArgument(message) {
    var error = new global.OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = "InvalidArgument";
    return error;
  }

  function queueProxy(object, range, kind) {
    object._range = range;
    object._rangeId = range._id;
    object.context._queue.push({
      op: "getRangeFormat",
      id: object._id,
      rangeId: range._id,
      kind: kind,
    });
  }

  function defineScalars(ctor, properties) {
    properties.forEach(function (name) {
      Object.defineProperty(ctor.prototype, name, {
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
    });
  }

  function combinedProperties(object, primary, additional) {
    var names = (object[primary] || []).slice();
    (object[additional] || []).forEach(function (name) {
      if (names.indexOf(name) < 0) names.push(name);
    });
    return names;
  }

  function scalarProperties(object) {
    return combinedProperties(
      object,
      "_scalarProperties",
      "_additionalScalarProperties"
    );
  }

  function navigationProperties(object) {
    return combinedProperties(
      object,
      "_navigationProperties",
      "_additionalNavigationProperties"
    );
  }

  function typeName(object) {
    return (
      object._typeName ||
      (object.constructor && object.constructor.name) ||
      "ClientObject"
    );
  }

  function setProperties(source, options) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }

    var isClientObject = source instanceof ClientObject;
    var properties = source;
    if (isClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      if (source.context !== this.context) {
        throw invalidArgument("The object passed to set must use the same context.");
      }
      properties = source.toJSON();
    }

    var scalarNames = scalarProperties(this);
    var navigationNames = navigationProperties(this);
    var readOnlyNames = this._readOnlyProperties || [];
    var throwOnReadOnly = !options || options.throwOnReadOnly !== false;

    // Validate the complete update object before queueing any member.  The
    // generated Office.js setters reject unknown names instead of silently
    // dropping them.  Client-object copies contain only loaded, settable
    // fields in toJSON(), so read-only fields are ignored for that overload.
    Object.keys(properties).forEach(function (name) {
      var known =
        scalarNames.indexOf(name) >= 0 || navigationNames.indexOf(name) >= 0;
      if (!known) {
        throw invalidArgument("Unknown " + typeName(this) + " property: " + name);
      }
      if (
        readOnlyNames.indexOf(name) >= 0 &&
        !isClientObject &&
        properties[name] !== undefined &&
        throwOnReadOnly
      ) {
        throw invalidArgument("The property '" + name + "' is read-only.");
      }
    }, this);

    for (var i = 0; i < scalarNames.length; i++) {
      var name = scalarNames[i];
      if (
        !Object.prototype.hasOwnProperty.call(properties, name) ||
        properties[name] === undefined ||
        readOnlyNames.indexOf(name) >= 0
      ) {
        continue;
      }
      this[name] = properties[name];
    }

    for (i = 0; i < navigationNames.length; i++) {
      name = navigationNames[i];
      if (
        !Object.prototype.hasOwnProperty.call(properties, name) ||
        properties[name] === undefined ||
        readOnlyNames.indexOf(name) >= 0
      ) {
        continue;
      }
      var child = isClientObject ? source[name] : properties[name];
      this[name].set(child, options);
    }
  }

  function toJSON() {
    var data = {};
    var scalarNames = scalarProperties(this);
    for (var i = 0; i < scalarNames.length; i++) {
      var name = scalarNames[i];
      if (this._loaded[name]) data[name] = this["_" + name];
    }

    var navigationNames = navigationProperties(this);
    for (i = 0; i < navigationNames.length; i++) {
      var navigationName = navigationNames[i];
      var child = this["_" + navigationName];
      if (child !== undefined && child !== null) {
        data[navigationName] =
          typeof child.toJSON === "function" ? child.toJSON() : child;
      }
    }
    return data;
  }

  function RangeFormat(context, range) {
    ClientObject.call(this, context);
    this._typeName = "RangeFormat";
    this._scalarProperties = [
      "horizontalAlignment",
      "verticalAlignment",
      "wrapText",
      "autoIndent",
      "indentLevel",
      "shrinkToFit",
      "textOrientation",
      "readingOrder",
      "columnWidth",
      "rowHeight",
    ];
    this._navigationProperties = ["font", "fill", "protection"];
    queueProxy(this, range, "format");
  }
  RangeFormat.prototype = Object.create(ClientObject.prototype);
  RangeFormat.prototype.constructor = RangeFormat;
  RangeFormat.prototype.set = setProperties;
  RangeFormat.prototype.toJSON = toJSON;
  defineScalars(RangeFormat, [
    "horizontalAlignment",
    "verticalAlignment",
    "wrapText",
    "autoIndent",
    "indentLevel",
    "shrinkToFit",
    "textOrientation",
    "readingOrder",
    "columnWidth",
    "rowHeight",
  ]);

  function RangeFont(context, range) {
    ClientObject.call(this, context);
    this._typeName = "RangeFont";
    this._scalarProperties = [
      "bold",
      "color",
      "italic",
      "name",
      "size",
      "underline",
      "strikethrough",
      "subscript",
      "superscript",
      "tintAndShade",
    ];
    queueProxy(this, range, "font");
  }
  RangeFont.prototype = Object.create(ClientObject.prototype);
  RangeFont.prototype.constructor = RangeFont;
  RangeFont.prototype.set = setProperties;
  RangeFont.prototype.toJSON = toJSON;
  defineScalars(RangeFont, [
    "bold", "color", "italic", "name", "size", "underline",
    "strikethrough", "subscript", "superscript", "tintAndShade",
  ]);

  function RangeFill(context, range) {
    ClientObject.call(this, context);
    this._typeName = "RangeFill";
    this._scalarProperties = [
      "color",
      "pattern",
      "patternColor",
      "patternTintAndShade",
      "tintAndShade",
    ];
    queueProxy(this, range, "fill");
  }
  RangeFill.prototype = Object.create(ClientObject.prototype);
  RangeFill.prototype.constructor = RangeFill;
  RangeFill.prototype.set = setProperties;
  RangeFill.prototype.toJSON = toJSON;
  RangeFill.prototype.clear = function () {
    this.context._queue.push({
      op: "set",
      id: this._id,
      property: "clear",
      value: null,
    });
  };
  defineScalars(RangeFill, [
    "color", "pattern", "patternColor", "patternTintAndShade", "tintAndShade",
  ]);

  function FormatProtection(context, range) {
    ClientObject.call(this, context);
    this._typeName = "FormatProtection";
    this._scalarProperties = ["locked", "formulaHidden"];
    queueProxy(this, range, "protection");
  }
  FormatProtection.prototype = Object.create(ClientObject.prototype);
  FormatProtection.prototype.constructor = FormatProtection;
  FormatProtection.prototype.set = setProperties;
  FormatProtection.prototype.toJSON = toJSON;
  defineScalars(FormatProtection, ["locked", "formulaHidden"]);

  Object.defineProperty(RangeFormat.prototype, "font", {
    get: function () {
      if (!this._font) this._font = new RangeFont(this.context, this._range);
      return this._font;
    },
  });
  Object.defineProperty(RangeFormat.prototype, "fill", {
    get: function () {
      if (!this._fill) this._fill = new RangeFill(this.context, this._range);
      return this._fill;
    },
  });
  Object.defineProperty(RangeFormat.prototype, "protection", {
    get: function () {
      if (!this._protection) {
        this._protection = new FormatProtection(this.context, this._range);
      }
      return this._protection;
    },
  });
  Object.defineProperty(Excel.Range.prototype, "format", {
    get: function () {
      if (!this._format) this._format = new RangeFormat(this.context, this);
      return this._format;
    },
  });

  Excel.RangeFormat = RangeFormat;
  Excel.RangeFont = RangeFont;
  Excel.RangeFill = RangeFill;
  Excel.FormatProtection = FormatProtection;
})(globalThis);
