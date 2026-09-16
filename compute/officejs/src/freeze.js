(function (global) {
  "use strict";

  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

  function FreezePaneCollection(context, worksheet) {
    ClientObject.call(this, context);
    this._worksheet = worksheet;
  }
  FreezePaneCollection.prototype = Object.create(ClientObject.prototype);
  FreezePaneCollection.prototype.constructor = FreezePaneCollection;

  FreezePaneCollection.prototype.freezeRows = function (count) {
    this.context._queue.push({
      op: "freezeRows",
      worksheetId: this._worksheet._id,
      count: count == null ? 1 : count,
    });
  };

  FreezePaneCollection.prototype.freezeColumns = function (count) {
    this.context._queue.push({
      op: "freezeColumns",
      worksheetId: this._worksheet._id,
      count: count == null ? 1 : count,
    });
  };

  FreezePaneCollection.prototype.freezeAt = function (range) {
    this.context._queue.push({
      op: "freezeAt",
      worksheetId: this._worksheet._id,
      rangeId: range && range._id ? range._id : null,
    });
  };

  function location(object, nullable) {
    var range = new Excel.Range(object.context, object._worksheet, null);
    object.context._queue.push({ op: "freezeLocation", id: range._id, worksheetId: object._worksheet._id, nullable: nullable });
    return range;
  }
  FreezePaneCollection.prototype.getLocation = function () { return location(this, false); };
  FreezePaneCollection.prototype.getLocationOrNullObject = function () { return location(this, true); };

  FreezePaneCollection.prototype.unfreeze = function () {
    this.context._queue.push({
      op: "unfreeze",
      worksheetId: this._worksheet._id,
    });
  };

  Object.defineProperty(Excel.Worksheet.prototype, "freezePanes", {
    configurable: true,
    get: function () {
      if (!this._freezePanes) {
        this._freezePanes = new FreezePaneCollection(this.context, this);
      }
      return this._freezePanes;
    },
  });

  Excel.WorksheetFreezePanes = FreezePaneCollection;
  Excel.FreezePaneCollection = FreezePaneCollection;
})(globalThis);
