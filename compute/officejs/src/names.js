(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var ClientObject = OfficeExtension.ClientObject;
  var configureCollection = global.__mogOfficeJs.configureCollection;

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

  function invalidRequestContext() {
    return new global.OfficeExtension.Error({
      code: "InvalidRequestContext",
      message: "The object belongs to a different request context.",
    });
  }

  function requirePropertyObject(source) {
    if (source == null || typeof source !== "object") {
      throw new TypeError("set requires a property object");
    }
  }

  function stringArgument(value, property) {
    if (typeof value !== "string") {
      throw new global.OfficeExtension.Error({
        code: "InvalidArgument",
        message: property + " must be a string",
      });
    }
    return value;
  }

  function collectionOptions(collection) {
    return {
      worksheetId: collection._worksheet ? collection._worksheet._id : null,
    };
  }

  function NamedItemCollection(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet || null;
    // Register the collection binding before any generic load/count request
    // reaches the host. The host needs the worksheet scope to resolve names.
    this.context._queue.push({
      op: "getNamedItemCollection",
      id: this._id,
      worksheetId: this._worksheet ? this._worksheet._id : null,
    });
    // `items` is hydrated through the shared collection descriptor hook. The
    // host returns `{ key, properties }` descriptors; the factory below calls
    // this collection's normal getItem path for each key.
    this._scalarProperties = ["items"];
    configureCollection(this, function (key) {
      return this.getItem(key);
    });
  }
  NamedItemCollection.prototype = Object.create(ClientObject.prototype);
  NamedItemCollection.prototype.constructor = NamedItemCollection;

  NamedItemCollection.prototype.add = function (name, reference, comment) {
    var itemName = stringArgument(name, "NamedItemCollection.add name");
    var operation = {
      op: "nameAdd",
      id: null,
      worksheetId: this._worksheet ? this._worksheet._id : null,
      name: itemName,
      comment: comment === undefined ? null : stringArgument(comment, "comment"),
      formulaLocal: false,
      reference: null,
      rangeId: null,
    };

    if (reference instanceof Excel.Range) {
      if (reference.context !== this.context) throw invalidRequestContext();
      operation.rangeId = reference._id;
    } else if (typeof reference === "string") {
      operation.reference = reference;
    } else {
      throw new global.OfficeExtension.Error({
        code: "InvalidArgument",
        message: "NamedItemCollection.add reference must be a Range or string",
      });
    }

    var item = new NamedItem(this.context, this);
    operation.id = item._id;
    this.context._queue.push(operation);
    return item;
  };

  NamedItemCollection.prototype.addFormulaLocal = function (name, formula, comment) {
    var itemName = stringArgument(name, "NamedItemCollection.addFormulaLocal name");
    var formulaText = stringArgument(formula, "formula");
    var item = new NamedItem(this.context, this);
    this.context._queue.push({
      op: "nameAdd",
      id: item._id,
      worksheetId: this._worksheet ? this._worksheet._id : null,
      name: itemName,
      comment: comment === undefined ? null : stringArgument(comment, "comment"),
      formulaLocal: true,
      reference: formulaText,
      rangeId: null,
    });
    return item;
  };

  NamedItemCollection.prototype.getCount = function () {
    var result = global.__mogOfficeJs.createClientResult(this.context);
    var options = collectionOptions(this);
    this.context._queue.push({
      op: "nameGetCount",
      resultId: result._id,
      worksheetId: options.worksheetId,
    });
    return result;
  };

  NamedItemCollection.prototype.getItem = function (name) {
    var itemName = stringArgument(name, "NamedItemCollection.getItem name");
    var item = new NamedItem(this.context, this);
    var options = collectionOptions(this);
    this.context._queue.push({
      op: "nameGetItem",
      id: item._id,
      worksheetId: options.worksheetId,
      name: itemName,
      orNullObject: false,
    });
    return item;
  };

  NamedItemCollection.prototype.getItemOrNullObject = function (name) {
    var itemName = stringArgument(name, "NamedItemCollection.getItemOrNullObject name");
    var item = new NamedItem(this.context, this);
    var options = collectionOptions(this);
    this.context._queue.push({
      op: "nameGetItem",
      id: item._id,
      worksheetId: options.worksheetId,
      name: itemName,
      orNullObject: true,
    });
    return item;
  };

  NamedItemCollection.prototype.toJSON = function () {
    if (!this._loaded.items) return {};
    return { items: this.items.map(function (item) { return item.toJSON(); }) };
  };

  function NamedItem(context, collection) {
    ClientObject.call(this, context);
    this._collection = collection;
    this._scalarProperties = [
      "comment",
      "formula",
      "name",
      "scope",
      "type",
      "value",
      "visible",
    ];
    this._navigationProperties = [
      "arrayValues",
      "worksheet",
      "worksheetOrNullObject",
    ];
  }
  NamedItem.prototype = Object.create(ClientObject.prototype);
  NamedItem.prototype.constructor = NamedItem;

  ["name", "scope", "type", "value"].forEach(function (name) {
    Object.defineProperty(NamedItem.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      configurable: true,
    });
  });

  ["comment", "formula", "visible"].forEach(function (name) {
    Object.defineProperty(NamedItem.prototype, name, {
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
      configurable: true,
    });
  });

  // `isNullObject` is supplied by the shared ClientObject implementation.
  // Keep the named item scalar list limited to the Office NamedItem fields;
  // null-object hydration is a transport detail and is never serialized as a
  // made-up NamedItem property.

  NamedItem.prototype.set = function (source) {
    requirePropertyObject(source);
    ["comment", "formula", "visible"].forEach(function (name) {
      if (source instanceof ClientObject) {
        if (source._loaded[name]) this[name] = source[name];
      } else if (Object.prototype.hasOwnProperty.call(source, name)) {
        this[name] = source[name];
      }
    }, this);
  };

  NamedItem.prototype.delete = function () {
    this.context._queue.push({ op: "nameDelete", id: this._id });
  };

  function namedRange(item, orNullObject) {
    // The host binds the resulting range by the NamedItem proxy ID. The range
    // constructor only needs a context here; its worksheet is resolved by the
    // host from the name definition itself.
    var range = new Excel.Range(item.context, null, null);
    item.context._queue.push({
      op: "nameGetRange",
      id: range._id,
      nameId: item._id,
      orNullObject: orNullObject,
    });
    return range;
  }

  NamedItem.prototype.getRange = function () {
    return namedRange(this, false);
  };

  NamedItem.prototype.getRangeOrNullObject = function () {
    return namedRange(this, true);
  };

  function namedWorksheet(item, orNullObject) {
    var worksheet = new Excel.Worksheet(item.context, null);
    item.context._queue.push({
      op: "nameGetWorksheet",
      id: worksheet._id,
      nameId: item._id,
      orNullObject: orNullObject === true,
    });
    return worksheet;
  }

  Object.defineProperty(NamedItem.prototype, "worksheet", {
    get: function () {
      if (!this._worksheet) this._worksheet = namedWorksheet(this, false);
      return this._worksheet;
    },
    configurable: true,
  });

  Object.defineProperty(NamedItem.prototype, "worksheetOrNullObject", {
    get: function () {
      if (!this._worksheetOrNullObject) {
        this._worksheetOrNullObject = namedWorksheet(this, true);
      }
      return this._worksheetOrNullObject;
    },
    configurable: true,
  });

  function NamedItemArrayValues(context, item) {
    ClientObject.call(this, context);
    this._item = item;
    this._scalarProperties = ["types", "values"];
    context._queue.push({
      op: "nameGetArrayValues",
      id: this._id,
      nameId: item._id,
    });
  }
  NamedItemArrayValues.prototype = Object.create(ClientObject.prototype);
  NamedItemArrayValues.prototype.constructor = NamedItemArrayValues;

  ["types", "values"].forEach(function (name) {
    Object.defineProperty(NamedItemArrayValues.prototype, name, {
      get: function () {
        if (!this._loaded[name]) throw propertyNotLoaded(name);
        return this["_" + name];
      },
      configurable: true,
    });
  });

  NamedItemArrayValues.prototype.toJSON = function () {
    var data = {};
    this._scalarProperties.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    return data;
  };

  Object.defineProperty(NamedItem.prototype, "arrayValues", {
    get: function () {
      if (!this._arrayValues) {
        this._arrayValues = new NamedItemArrayValues(this.context, this);
      }
      return this._arrayValues;
    },
    configurable: true,
  });

  NamedItem.prototype.toJSON = function () {
    var data = {};
    this._scalarProperties.forEach(function (name) {
      if (this._loaded[name]) data[name] = this["_" + name];
    }, this);
    if (this._arrayValues && (this._arrayValues._loaded.types || this._arrayValues._loaded.values)) {
      data.arrayValues = this._arrayValues.toJSON();
    }
    return data;
  };

  Object.defineProperty(Excel.Workbook.prototype, "names", {
    get: function () {
      if (!this._names) this._names = new NamedItemCollection(this.context, null);
      return this._names;
    },
    configurable: true,
  });

  Object.defineProperty(Excel.Worksheet.prototype, "names", {
    get: function () {
      if (!this._names) this._names = new NamedItemCollection(this.context, this);
      return this._names;
    },
    configurable: true,
  });

  Excel.NamedItemCollection = NamedItemCollection;
  Excel.NamedItem = NamedItem;
  Excel.NamedItemArrayValues = NamedItemArrayValues;
})(globalThis);
