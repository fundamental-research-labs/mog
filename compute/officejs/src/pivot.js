(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

  function PivotHierarchy(context, pivot, name) {
    ClientObject.call(this, context);
    this._pivot = pivot;
    this._name = name;
  }
  PivotHierarchy.prototype = Object.create(ClientObject.prototype);
  PivotHierarchy.prototype.constructor = PivotHierarchy;

  function PivotHierarchyCollection(context, pivot) {
    ClientObject.call(this, context);
    this._pivot = pivot;
    this._items = {};
  }
  PivotHierarchyCollection.prototype = Object.create(ClientObject.prototype);
  PivotHierarchyCollection.prototype.constructor = PivotHierarchyCollection;

  PivotHierarchyCollection.prototype.getItem = function (name) {
    var key = String(name);
    if (!this._items[key]) {
      this._items[key] = new PivotHierarchy(this.context, this._pivot, key);
    }
    return this._items[key];
  };

  function PivotHierarchyList(context, pivot, area) {
    ClientObject.call(this, context);
    this._pivot = pivot;
    this._area = area;
  }
  PivotHierarchyList.prototype = Object.create(ClientObject.prototype);
  PivotHierarchyList.prototype.constructor = PivotHierarchyList;

  PivotHierarchyList.prototype.add = function (hierarchy) {
    var name = hierarchy && hierarchy._name ? hierarchy._name : String(hierarchy);
    this.context._queue.push({
      op: "pivotHierarchyAdd",
      pivotId: this._pivot._id,
      area: this._area,
      field: name,
    });
    return hierarchy;
  };

  function DataHierarchy(context, pivot, name) {
    ClientObject.call(this, context);
    this._pivot = pivot;
    this._name = name;
  }
  DataHierarchy.prototype = Object.create(ClientObject.prototype);
  DataHierarchy.prototype.constructor = DataHierarchy;

  Object.defineProperty(DataHierarchy.prototype, "summarizeBy", {
    set: function (value) {
      this.context._queue.push({
        op: "set",
        id: this._pivot._id,
        property: "summarizeBy",
        value: { field: this._name, function: value },
      });
    },
  });

  function DataHierarchyList(context, pivot) {
    ClientObject.call(this, context);
    this._pivot = pivot;
  }
  DataHierarchyList.prototype = Object.create(ClientObject.prototype);
  DataHierarchyList.prototype.constructor = DataHierarchyList;

  DataHierarchyList.prototype.add = function (hierarchy) {
    var name = hierarchy && hierarchy._name ? hierarchy._name : String(hierarchy);
    var item = new DataHierarchy(this.context, this._pivot, name);
    this.context._queue.push({
      op: "pivotHierarchyAdd",
      pivotId: this._pivot._id,
      area: "data",
      field: name,
    });
    return item;
  };

  function PivotTable(context) {
    ClientObject.call(this, context);
    this.hierarchies = new PivotHierarchyCollection(context, this);
    this.rowHierarchies = new PivotHierarchyList(context, this, "row");
    this.columnHierarchies = new PivotHierarchyList(context, this, "column");
    this.filterHierarchies = new PivotHierarchyList(context, this, "filter");
    this.dataHierarchies = new DataHierarchyList(context, this);
  }
  PivotTable.prototype = Object.create(ClientObject.prototype);
  PivotTable.prototype.constructor = PivotTable;

  Object.defineProperty(PivotTable.prototype, "name", {
    set: function (value) {
      this.context._queue.push({
        op: "set",
        id: this._id,
        property: "name",
        value: value,
      });
    },
  });

  function PivotTableCollection(context, workbook) {
    ClientObject.call(this, context);
    this._workbook = workbook;
  }
  PivotTableCollection.prototype = Object.create(ClientObject.prototype);
  PivotTableCollection.prototype.constructor = PivotTableCollection;

  PivotTableCollection.prototype.add = function (name, source, destination) {
    var pivot = new PivotTable(this.context);
    this.context._queue.push({
      op: "pivotAdd",
      id: pivot._id,
      name: String(name),
      sourceRangeId: source._id,
      destinationRangeId: destination._id,
    });
    return pivot;
  };

  Object.defineProperty(Excel.Workbook.prototype, "pivotTables", {
    configurable: true,
    get: function () {
      if (!this._pivotTables) {
        this._pivotTables = new PivotTableCollection(this.context, this);
      }
      return this._pivotTables;
    },
  });

  Excel.PivotTable = PivotTable;
  Excel.PivotTableCollection = PivotTableCollection;
})(globalThis);
