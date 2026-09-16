(function (global) {
  "use strict";
  var Excel = global.Excel;
  var ClientObject = global.OfficeExtension.ClientObject;

  function Filter(context, column) {
    ClientObject.call(this, context);
    this._column = column;
    this._scalarProperties = ["criteria"];
    context._queue.push({ op: "tableFilterGet", id: this._id, columnId: column._id });
  }
  Filter.prototype = Object.create(ClientObject.prototype);
  Filter.prototype.constructor = Filter;
  Object.defineProperty(Filter.prototype, "criteria", {
    get: function () {
      if (!this._loaded.criteria) throw new global.OfficeExtension.Error({
        code: "PropertyNotLoaded", message: "Load Filter.criteria and sync before reading it."
      });
      return this._criteria;
    }
  });
  Filter.prototype.apply = function (criteria) {
    this.context._queue.push({ op: "tableFilterApply", id: this._id, criteria: criteria });
  };
  Filter.prototype.clear = function () {
    this.context._queue.push({ op: "tableFilterClear", id: this._id });
  };
  Filter.prototype.applyValuesFilter = function (values) {
    this.apply({ filterOn: "Values", values: values });
  };
  Filter.prototype.applyCustomFilter = function (criteria1, criteria2, oper) {
    this.apply({ filterOn: "Custom", criterion1: criteria1, criterion2: criteria2, operator: oper });
  };
  Filter.prototype.applyDynamicFilter = function (criteria) {
    this.apply({ filterOn: "Dynamic", dynamicCriteria: criteria });
  };
  Filter.prototype.applyCellColorFilter = function (color) {
    this.apply({ filterOn: "CellColor", color: color });
  };
  Filter.prototype.applyFontColorFilter = function (color) {
    this.apply({ filterOn: "FontColor", color: color });
  };
  Filter.prototype.applyTopItemsFilter = function (count) {
    this.apply({ filterOn: "TopItems", criterion1: String(count) });
  };
  Filter.prototype.applyBottomItemsFilter = function (count) {
    this.apply({ filterOn: "BottomItems", criterion1: String(count) });
  };
  Filter.prototype.applyTopPercentFilter = function (percent) {
    this.apply({ filterOn: "TopPercent", criterion1: String(percent) });
  };
  Filter.prototype.applyBottomPercentFilter = function (percent) {
    this.apply({ filterOn: "BottomPercent", criterion1: String(percent) });
  };
  Filter.prototype.toJSON = function () {
    return this._loaded.criteria ? { criteria: this._criteria } : {};
  };
  Object.defineProperty(Excel.TableColumn.prototype, "filter", {
    get: function () {
      if (!this._filter) this._filter = new Filter(this.context, this);
      return this._filter;
    }
  });
  Excel.Table.prototype.clearFilters = function () {
    this.context._queue.push({ op: "tableClearFilters", tableId: this._id });
  };
  Excel.Table.prototype.reapplyFilters = function () {
    this.context._queue.push({ op: "tableReapplyFilters", tableId: this._id });
  };
  Excel.Filter = Filter;
})(globalThis);
