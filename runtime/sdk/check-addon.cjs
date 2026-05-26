const addon = require('@mog/compute-core-napi');
console.log('addon keys:', Object.keys(addon).sort().join(', '));
// ComputeEngine is the class; check its prototype
const proto = addon.ComputeEngine.prototype;
const methods = Object.getOwnPropertyNames(proto)
  .filter((n) => n !== 'constructor')
  .sort();
console.log('Total ComputeEngine prototype methods:', methods.length);
const matched = methods.filter(
  (m) =>
    m.toLowerCase().includes('recalc') ||
    m.toLowerCase().includes('batch') ||
    m.toLowerCase().includes('full'),
);
console.log('recalc/batch/full:', JSON.stringify(matched));
methods.forEach((m) => console.log(m));
