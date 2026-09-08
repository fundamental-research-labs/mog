(function (global) {
  "use strict";

  var Excel = global.Excel;
  var OfficeExtension = global.OfficeExtension;
  var Worksheet = Excel.Worksheet;
  var WorksheetCollection = Excel.WorksheetCollection;
  var officeJs = global.__mogOfficeJs;

  officeJs.addScalarProperties(Worksheet.prototype, ["position", "visibility"]);

  function ensureCollection(collection) {
    if (collection._worksheetCollectionConfigured) return;

    collection.context._queue.push({
      op: "getWorksheetCollection",
      id: collection._id,
    });
    collection._scalarProperties = collection._scalarProperties || [];
    if (collection._scalarProperties.indexOf("items") < 0) {
      collection._scalarProperties.push("items");
    }

    officeJs.configureCollection(collection, function (key) {
      // Collection hydration deliberately enters the normal getItem path.
      // That path allocates/registers a real Worksheet proxy and queues its
      // host binding, preserving all regular object-path semantics.
      return collection.getItem(String(key));
    });
    collection._worksheetCollectionConfigured = true;
  }

  // Keep the collection property present before its first load.  The shared
  // collection helper supplies `_hydrateItems`; this descriptor supplies the
  // normal Office.js unloaded-property behavior until that hydration occurs.
  Object.defineProperty(WorksheetCollection.prototype, "items", {
    configurable: true,
    get: function () {
      ensureCollection(this);
      if (!this._loaded.items) {
        throw new OfficeExtension.Error({
          code: "PropertyNotLoaded",
          message: "The worksheet collection property has not been loaded: items",
        });
      }
      return this._items;
    },
  });

  function newWorksheet(context) {
    return new Worksheet(context, null);
  }

  function queueRelatedWorksheet(worksheet, op, visibleOnly, orNull) {
    var payload = {
      op: op,
      id: worksheet._id,
      worksheetId: worksheet._worksheetSourceId,
      visibleOnly: visibleOnly === true,
      orNull: orNull === true,
    };
    worksheet.context._queue.push(payload);
    return worksheet;
  }

  // The runtime owns result allocation and hydration.  This adapter only
  // keeps the worksheet operation's wire shape close to the method that
  // returns it.
  function newClientResult(context) {
    return officeJs.createClientResult(context);
  }

  function resultId(result) {
    return result._id;
  }

  // Worksheet scalar properties.  The base bootstrap defines name and id;
  // name becomes configurable in the runtime so this extension can add the
  // documented setter without replacing the Worksheet constructor.
  var nameDescriptor = Object.getOwnPropertyDescriptor(Worksheet.prototype, "name");
  if (nameDescriptor && !nameDescriptor.configurable) {
    throw new Error(
      "Worksheet.name must be configurable before the Office.js worksheet extension is loaded"
    );
  }
  Object.defineProperty(Worksheet.prototype, "name", {
    configurable: true,
    enumerable: nameDescriptor ? nameDescriptor.enumerable : false,
    get: nameDescriptor && nameDescriptor.get
      ? nameDescriptor.get
      : undefined,
    set: function (value) {
      this._name = value;
      this._loaded.name = true;
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "name",
        value: value,
      });
    },
  });

  function scalarProperty(name) {
    Object.defineProperty(Worksheet.prototype, name, {
      configurable: true,
      get: function () {
        if (!this._loaded[name]) {
          throw new OfficeExtension.Error({
            code: "PropertyNotLoaded",
            message: "The worksheet property has not been loaded: " + name,
          });
        }
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
  }

  scalarProperty("position");
  scalarProperty("visibility");

  Worksheet.prototype.toJSON = function () {
    var data = {};
    ["id", "name", "position", "visibility"].forEach(function (name) {
      if (!this._loaded[name]) return;
      data[name] = name === "id" ? this._idValue : this["_" + name];
    }, this);
    return data;
  };

  Worksheet.prototype.activate = function () {
    this.context._queue.push({ op: "worksheetActivate", id: this._id });
  };

  Worksheet.prototype.delete = function () {
    this.context._queue.push({ op: "worksheetDelete", id: this._id });
  };

  Worksheet.prototype.getNext = function (visibleOnly) {
    var worksheet = newWorksheet(this.context);
    worksheet._worksheetSourceId = this._id;
    return queueRelatedWorksheet(
      worksheet,
      "worksheetGetNext",
      visibleOnly,
      false
    );
  };

  Worksheet.prototype.getNextOrNullObject = function (visibleOnly) {
    var worksheet = newWorksheet(this.context);
    worksheet._worksheetSourceId = this._id;
    return queueRelatedWorksheet(
      worksheet,
      "worksheetGetNext",
      visibleOnly,
      true
    );
  };

  Worksheet.prototype.getPrevious = function (visibleOnly) {
    var worksheet = newWorksheet(this.context);
    worksheet._worksheetSourceId = this._id;
    return queueRelatedWorksheet(
      worksheet,
      "worksheetGetPrevious",
      visibleOnly,
      false
    );
  };

  Worksheet.prototype.getPreviousOrNullObject = function (visibleOnly) {
    var worksheet = newWorksheet(this.context);
    worksheet._worksheetSourceId = this._id;
    return queueRelatedWorksheet(
      worksheet,
      "worksheetGetPrevious",
      visibleOnly,
      true
    );
  };

  var collectionGetItem = WorksheetCollection.prototype.getItem;
  WorksheetCollection.prototype.getItem = function (key) {
    ensureCollection(this);
    return collectionGetItem.call(this, key);
  };

  var collectionGetActiveWorksheet = WorksheetCollection.prototype.getActiveWorksheet;
  WorksheetCollection.prototype.getActiveWorksheet = function () {
    ensureCollection(this);
    return collectionGetActiveWorksheet.call(this);
  };

  var collectionAdd = WorksheetCollection.prototype.add;
  WorksheetCollection.prototype.add = function (name) {
    ensureCollection(this);
    return collectionAdd.call(this, name);
  };

  var collectionLoad = WorksheetCollection.prototype.load;
  WorksheetCollection.prototype.load = function (props) {
    ensureCollection(this);
    return collectionLoad.call(this, props);
  };

  WorksheetCollection.prototype.getItemOrNullObject = function (key) {
    ensureCollection(this);
    var worksheet = newWorksheet(this.context);
    this.context._queue.push({
      op: "worksheetGetItemOrNullObject",
      id: worksheet._id,
      key: String(key),
    });
    return worksheet;
  };

  WorksheetCollection.prototype.getCount = function (visibleOnly) {
    ensureCollection(this);
    var result = newClientResult(this.context);
    this.context._queue.push({
      op: "worksheetCollectionGetCount",
      collectionId: this._id,
      resultId: resultId(result),
      visibleOnly: visibleOnly === true,
    });
    return result;
  };

  function collectionEdge(collection, operation, visibleOnly, orNull) {
    ensureCollection(collection);
    var worksheet = newWorksheet(collection.context);
    collection.context._queue.push({
      op: operation,
      collectionId: collection._id,
      id: worksheet._id,
      visibleOnly: visibleOnly === true,
      orNull: orNull === true,
    });
    return worksheet;
  }

  WorksheetCollection.prototype.getFirst = function (visibleOnly) {
    return collectionEdge(
      this,
      "worksheetCollectionGetFirst",
      visibleOnly,
      false
    );
  };

  WorksheetCollection.prototype.getLast = function (visibleOnly) {
    return collectionEdge(
      this,
      "worksheetCollectionGetLast",
      visibleOnly,
      false
    );
  };

  WorksheetCollection.prototype.toJSON = function () {
    ensureCollection(this);
    if (!this._loaded.items) return {};
    return {
      items: (this._items || []).map(function (item) {
        return item && typeof item.toJSON === "function" ? item.toJSON() : item;
      }),
    };
  };

  Excel.Worksheet = Worksheet;
  Excel.WorksheetCollection = WorksheetCollection;
})(globalThis);
