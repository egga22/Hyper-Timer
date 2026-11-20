const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
const context = vm.createContext({ userPreferences: { fullscreenControls: ['pause', 'duplicate'] } });
vm.runInContext(source.slice(source.indexOf('  const FULLSCREEN_CONTROLS ='), source.indexOf('  function refreshFullscreenControls(')), context);
const controls = timer => Array.from(context.effectiveFullscreenControls(timer));
test('older timers inherit defaults while empty overrides hide every optional control', () => {
  assert.deepEqual(controls({}), ['pause', 'duplicate']);
  assert.deepEqual(controls({ fullscreenControls: null }), ['pause', 'duplicate']);
  assert.deepEqual(controls({ fullscreenControls: [] }), []);
  assert.deepEqual(controls({ fullscreenControls: ['prestige'] }), ['prestige']);
});
test('invalid actions are removed and overrides remain independent of default changes', () => {
  assert.deepEqual(controls({ fullscreenControls: ['delete', 'unknown', 'delete', 'fullscreen'] }), ['delete']);
  context.userPreferences.fullscreenControls = ['edit'];
  assert.deepEqual(controls({}), ['edit']);
  assert.deepEqual(controls({ fullscreenControls: ['pause'] }), ['pause']);
});
