(function (global) {
  "use strict";

  function propertyNotLoaded(name) {
    var err = new Error(
      "The property '" +
        name +
        "' is not available. Before reading the property's value, call the load method on the containing object and call \"context.sync()\" on the associated request context."
    );
    err.name = "RichApi.Error";
    err.code = "PropertyNotLoaded";
    return err;
  }

  function normalizeLoad(props) {
    if (props == null || props === undefined) {
      return ["values", "formulas"];
    }
    if (typeof props === "string") {
      return props
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }
    if (Array.isArray(props)) {
      return props.slice();
    }
    if (typeof props === "object") {
      return Object.keys(props).filter(function (k) {
        return props[k];
      });
    }
    return [String(props)];
  }

  var nextId = 1;
  function newId() {
    return "obj_" + nextId++;
  }

  function ClientObject(context) {
    this.context = context;
    this._id = newId();
    this._loaded = Object.create(null);
    context._objects[this._id] = this;
  }

  ClientObject.prototype.load = function (props) {
    this.context._queue.push({
      op: "load",
      id: this._id,
      properties: normalizeLoad(props),
    });
    return this;
  };

  function RequestContext() {
    this._queue = [];
    this._objects = Object.create(null);
    this.workbook = new Workbook(this);
  }

  RequestContext.prototype.sync = async function () {
    var ops = this._queue.splice(0, this._queue.length);
    var raw = __mogApply(JSON.stringify(ops));
    var result = JSON.parse(raw);
    if (result.error) {
      var err = new Error(result.error.message || "Office.js error");
      err.name = "RichApi.Error";
      err.code = result.error.code || "GeneralException";
      throw err;
    }
    var loaded = result.loaded || {};
    var id;
    for (id in loaded) {
      if (!Object.prototype.hasOwnProperty.call(loaded, id)) continue;
      var obj = this._objects[id];
      if (!obj) continue;
      var props = loaded[id];
      var key;
      for (key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        obj._loaded[key] = true;
        obj["_" + key] = props[key];
      }
    }
  };

  function Workbook(context) {
    ClientObject.call(this, context);
    this.worksheets = new WorksheetCollection(context);
  }
  Workbook.prototype = Object.create(ClientObject.prototype);
  Workbook.prototype.constructor = Workbook;

  function WorksheetCollection(context) {
    ClientObject.call(this, context);
  }
  WorksheetCollection.prototype = Object.create(ClientObject.prototype);
  WorksheetCollection.prototype.constructor = WorksheetCollection;

  WorksheetCollection.prototype.getItem = function (name) {
    var ws = new Worksheet(this.context, String(name));
    this.context._queue.push({
      op: "getItem",
      id: ws._id,
      name: String(name),
    });
    return ws;
  };

  WorksheetCollection.prototype.add = function (name) {
    var ws = new Worksheet(this.context, name == null ? null : String(name));
    this.context._queue.push({
      op: "addWorksheet",
      id: ws._id,
      name: name == null ? null : String(name),
    });
    return ws;
  };

  function Worksheet(context, name) {
    ClientObject.call(this, context);
    this._nameHint = name;
  }
  Worksheet.prototype = Object.create(ClientObject.prototype);
  Worksheet.prototype.constructor = Worksheet;

  Object.defineProperty(Worksheet.prototype, "name", {
    get: function () {
      if (!this._loaded.name) {
        throw propertyNotLoaded("name");
      }
      return this._name;
    },
  });

  Worksheet.prototype.getRange = function (address) {
    var range = new Range(this.context, this, String(address));
    this.context._queue.push({
      op: "getRange",
      id: range._id,
      worksheetId: this._id,
      address: String(address),
    });
    return range;
  };

  function Range(context, worksheet, address) {
    ClientObject.call(this, context);
    this._worksheet = worksheet;
    this._address = address;
  }
  Range.prototype = Object.create(ClientObject.prototype);
  Range.prototype.constructor = Range;

  Object.defineProperty(Range.prototype, "values", {
    get: function () {
      if (!this._loaded.values) {
        throw propertyNotLoaded("values");
      }
      return this._values;
    },
    set: function (value) {
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "values",
        value: value,
      });
    },
  });

  Object.defineProperty(Range.prototype, "formulas", {
    get: function () {
      if (!this._loaded.formulas) {
        throw propertyNotLoaded("formulas");
      }
      return this._formulas;
    },
    set: function (value) {
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "formulas",
        value: value,
      });
    },
  });

  var pendingRuns = [];

  function run(arg) {
    var callback = typeof arg === "function" ? arg : arg && arg.batch;
    if (typeof callback !== "function") {
      return Promise.reject(new TypeError("Excel.run requires a function"));
    }
    var promise = (async function () {
      var context = new RequestContext();
      var result = await callback(context);
      await context.sync();
      return result;
    })();
    pendingRuns.push(promise);
    return promise;
  }

  global.__mogPendingRuns = pendingRuns;
  global.Excel = { run: run };
  global.OfficeExtension = {
    ClientObject: ClientObject,
    RequestContext: RequestContext,
  };
})(globalThis);
