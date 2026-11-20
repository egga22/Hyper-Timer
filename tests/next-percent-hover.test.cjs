const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const split = source.slice(source.indexOf('  function splitTime('), source.indexOf('  function fmtCustom('));
const hover = source.slice(source.indexOf('  function updatePercentHover('), source.indexOf('  function drawVisual('));
const context = { baseTotal: timer => timer.duration, remainingMs: timer => timer.remaining };
vm.runInNewContext(split + hover, context);

test('hover follows the rounded percentage and refreshes its label', () => {
  const span = { dataset: {} };
  const timer = { duration: 200000, remaining: 102000 };
  context.updatePercentHover(span, timer, true);
  assert.equal(span.dataset.nextPercent, '1s to 50%');
  timer.remaining = 101000;
  context.updatePercentHover(span, timer, true);
  assert.equal(span.dataset.nextPercent, '2s to 51%');
  context.updatePercentHover(span, timer, false);
  assert.equal(span.dataset.nextPercent, undefined);
});

test('hover accounts for delayed starts, pauses, and rounded 100 percent', () => {
  const timer = { duration: 200000, remaining: 250000 };
  assert.equal(context.calculateTimeToNextPercent(timer), '51s to 1%');
  timer.remaining = 102000;
  timer.paused = true;
  assert.equal(context.calculateTimeToNextPercent(timer), 'Paused · 1s to 50%');
  timer.paused = false;
  timer.remaining = 800;
  assert.equal(context.calculateTimeToNextPercent(timer), '1s until complete');
  timer.remaining = 0;
  assert.equal(context.calculateTimeToNextPercent(timer), 'Timer complete');
});
