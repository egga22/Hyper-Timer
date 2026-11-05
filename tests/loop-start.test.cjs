const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
process.env.TZ = 'America/Chicago';
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
const start = source.indexOf('  function loopStartTimestamp(');
const end = source.indexOf('\n  function ', start + 1);
const context = vm.createContext({ Date, Math, Number });
vm.runInContext(source.slice(start, end), context);
const calculate = context.loopStartTimestamp;
const config = { startBehavior: 'custom', startDayOffset: 0, startTime: '08:00', startWeekdays: ['', '', '', '09:30', '', '', ''] };
const ts = value => new Date(value).getTime();
test('weekday override and normal day use the next end date', () => {
  assert.equal(calculate(config, ts('2026-11-11T15:00:00'), 0, 0, 0), ts('2026-11-11T09:30:00'));
  assert.equal(calculate(config, ts('2026-11-12T15:00:00'), 0, 0, 0), ts('2026-11-12T08:00:00'));
});
test('overnight starts use the start weekday and cross month/year boundaries', () => {
  assert.equal(calculate({ ...config, startDayOffset: -1 }, ts('2026-11-12T06:00:00'), 0, 0, 0), ts('2026-11-11T09:30:00'));
  assert.equal(calculate({ ...config, startDayOffset: -1 }, ts('2027-01-01T06:00:00'), 0, 0, 0), ts('2026-12-31T08:00:00'));
});
test('custom local clocks follow DST rather than subtracting 24 hours', () => {
  assert.equal(calculate({ ...config, startDayOffset: -1 }, ts('2027-03-14T16:00:00'), 0, 0, 0), ts('2027-03-13T08:00:00'));
});
test('other dropdown choices preserve their distinct meaning', () => {
  assert.equal(calculate({startBehavior:'restart'}, 10000, 2000, 3000, 4000), 4000);
  assert.equal(calculate({startBehavior:'previousEnd'}, 10000, 2000, 3000, 4000), 2000);
  assert.equal(calculate({startBehavior:'sameDuration'}, 10000, 2000, 3000, 4000), 7000);
});
