(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;

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

  function registerScalarProperties(names) {
    // Runtime foundation owns the load normalization hook for all Office.js
    // extension families. Registering through it keeps this projection on
    // the production ClientObject.load path.
    global.__mogOfficeJs.addScalarProperties(Excel.Range.prototype, names);
  }

  function invalidArgument(message) {
    var error = new OfficeExtension.Error({
      code: "InvalidArgument",
      message: message,
    });
    error.name = "RichApi.Error";
    error.code = "InvalidArgument";
    return error;
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function combinedProperties(object, primary, additional) {
    var result = (object[primary] || []).slice();
    (object[additional] || []).forEach(function (name) {
      if (result.indexOf(name) < 0) result.push(name);
    });
    return result;
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

  // Range.set accepts the writable members represented by this projection.
  // Keep the read-only list explicit so a plain object can honor the
  // documented UpdateOptions.throwOnReadOnly behavior without touching any
  // unloaded property getter. A Range source is copied from its loaded JSON,
  // where read-only metadata is intentionally ignored by the copy operation.
  var writableScalars = {
    values: true,
    formulas: true,
    numberFormat: true,
  };

  function setProperties(source, options) {
    requirePropertyObject(source);

    var isClientObject = source instanceof ClientObject;
    var properties = source;
    if (isClientObject) {
      if (Object.getPrototypeOf(this) !== Object.getPrototypeOf(source)) {
        throw invalidArgument("The object passed to set must have the same type.");
      }
      properties = source.toJSON();
    }

    var throwOnReadOnly = !options || options.throwOnReadOnly !== false;
    var names = scalarProperties(this);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (!Object.prototype.hasOwnProperty.call(properties, name)) continue;
      if (properties[name] === undefined) continue;
      if (!writableScalars[name]) {
        if (!isClientObject && throwOnReadOnly) {
          throw invalidArgument("The property '" + name + "' is read-only.");
        }
        continue;
      }
      this[name] = properties[name];
    }

    names = navigationProperties(this);
    for (i = 0; i < names.length; i++) {
      name = names[i];
      if (!Object.prototype.hasOwnProperty.call(properties, name)) continue;
      if (properties[name] === undefined) continue;
      var child = isClientObject ? source[name] : properties[name];
      this[name].set(child, options);
    }
  }

  function toJSON() {
    var data = {};
    var names = scalarProperties(this);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (this._loaded[name]) data[name] = this["_" + name];
    }

    names = navigationProperties(this);
    for (i = 0; i < names.length; i++) {
      var navigationName = names[i];
      var child = this["_" + navigationName];
      if (child !== undefined && child !== null) {
        data[navigationName] =
          typeof child.toJSON === "function" ? child.toJSON() : child;
      }
    }
    return data;
  }

  function defineLoadedScalar(name) {
    Object.defineProperty(Excel.Range.prototype, name, {
      configurable: true,
      enumerable: true,
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
    });
  }

  registerScalarProperties(["numberFormat", "text", "valueTypes"]);
  defineLoadedScalar("text");
  defineLoadedScalar("valueTypes");

  Object.defineProperty(Excel.Range.prototype, "numberFormat", {
    configurable: true,
    enumerable: true,
    get: function () {
      if (!this._loaded.numberFormat) throw propertyNotLoaded("numberFormat");
      return this._numberFormat;
    },
    set: function (value) {
      this._numberFormat = value;
      this._loaded.numberFormat = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "numberFormat",
        value: value,
      });
    },
  });

  // Excel.ClearApplyTo's documented string values are deliberately preserved
  // on the wire. The Rust helper maps only modes backed by compute-api
  // primitives; unsupported modes reject at context.sync().
  var clearModes = {
    All: "All",
    Formats: "Formats",
    Contents: "Contents",
    Hyperlinks: "Hyperlinks",
    RemoveHyperlinks: "RemoveHyperlinks",
    ResetContents: "ResetContents",
  };

  Excel.Range.prototype.clear = function (applyTo) {
    var mode = applyTo == null ? "All" : clearModes[applyTo];
    if (mode === undefined) {
      // Preserve deferred Rich API error timing: the invalid operation is
      // reported by the host when this batch is synchronized.
      mode = applyTo;
    }
    this.context._queue.push({
      op: "rangeClear",
      id: this._id,
      applyTo: mode,
    });
  };

  Excel.Range.prototype.set = setProperties;
  Excel.Range.prototype.toJSON = toJSON;
})(globalThis);
