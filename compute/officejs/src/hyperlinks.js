(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var officeJs = global.__mogOfficeJs;

  function richApiError(code, message) {
    var error = new OfficeExtension.Error({
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

  function invalidArgument(message) {
    return richApiError("InvalidArgument", message);
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  var fields = [
    "address",
    "documentReference",
    "screenTip",
    "textToDisplay",
  ];

  // RangeHyperlink is a plain value object, rather than a child ClientObject.
  // Keep only declared fields on the wire and reject accidental dialect fields
  // instead of silently dropping caller intent.
  function normalizeHyperlink(value) {
    if (!isPlainObject(value)) {
      throw invalidArgument("Range.hyperlink must be a plain object");
    }

    var normalized = {};
    Object.keys(value).forEach(function (name) {
      if (fields.indexOf(name) < 0) {
        throw invalidArgument(
          "Unsupported Range.hyperlink property '" + name + "'"
        );
      }

      // JSON.stringify omits undefined properties. Treating undefined as an
      // omitted optional member gives the same behavior before a sync while
      // retaining strict string typing for values that reach the host.
      if (value[name] === undefined) return;
      if (typeof value[name] !== "string") {
        throw invalidArgument("Range.hyperlink." + name + " must be a string");
      }
      normalized[name] = value[name];
    });
    return normalized;
  }

  function copyWithoutHyperlink(source, isClientObject) {
    var result = {};
    Object.keys(source).forEach(function (name) {
      if (name === "hyperlink") return;
      // range_content.js treats a ClientObject source specially: writable
      // fields are copied while read-only scalar metadata is ignored. Once we
      // materialize toJSON in this wrapper, retain that distinction explicitly.
      if (
        isClientObject &&
        ["values", "formulas", "numberFormat", "format"].indexOf(name) < 0
      ) {
        return;
      }
      result[name] = source[name];
    });
    return result;
  }

  function sourceProperties(source) {
    if (source instanceof ClientObject) {
      return source.toJSON();
    }
    if (source === null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
    return source;
  }

  if (officeJs && typeof officeJs.addScalarProperties === "function") {
    officeJs.addScalarProperties(Excel.Range.prototype, ["hyperlink"]);
  } else {
    var scalar = Excel.Range.prototype._additionalScalarProperties || [];
    if (scalar.indexOf("hyperlink") < 0) scalar.push("hyperlink");
    Excel.Range.prototype._additionalScalarProperties = scalar;
  }

  Object.defineProperty(Excel.Range.prototype, "hyperlink", {
    configurable: true,
    enumerable: true,
    get: function () {
      if (!this._loaded.hyperlink) throw propertyNotLoaded("hyperlink");
      return this._hyperlink;
    },
    set: function (value) {
      var normalized = normalizeHyperlink(value);
      this._hyperlink = normalized;
      this._loaded.hyperlink = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "hyperlink",
        value: normalized,
      });
    },
  });

  // range_content.js owns the general Range.set implementation. Extend it
  // here after that projection is installed, retaining its UpdateOptions and
  // format/value handling while making hyperlink a writable Range scalar.
  var previousSet = Excel.Range.prototype.set;
  Excel.Range.prototype.set = function (source, options) {
    var isClientObject = source instanceof ClientObject;
    if (
      isClientObject &&
      Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)
    ) {
      throw invalidArgument("The object passed to set must have the same type.");
    }
    var properties = sourceProperties(source);
    var hasHyperlink = Object.prototype.hasOwnProperty.call(
      properties,
      "hyperlink"
    );
    var normalized = hasHyperlink
      ? normalizeHyperlink(properties.hyperlink)
      : null;

    if (typeof previousSet === "function") {
      var remaining = hasHyperlink
        ? copyWithoutHyperlink(properties, isClientObject)
        : source;
      if (remaining instanceof ClientObject || Object.keys(remaining).length > 0) {
        previousSet.call(this, remaining, options);
      }
    }
    // Validate the hyperlink before this point, so a malformed value cannot
    // leave a queued hyperlink operation behind when another Range.set field
    // is rejected. Queue it after the existing Range.set work has validated.
    if (hasHyperlink) {
      this.hyperlink = normalized;
    }
  };
})(globalThis);
