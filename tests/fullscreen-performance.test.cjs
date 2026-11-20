const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');

test('fullscreen changes redraw both sizes next frame and coalesce duplicate events', () => {
  const frames = [], draws = [], listeners = {};
  const timer = { id: 'timer', style: 'pro' };
  const canvas = {};
  const card = { isConnected: true, dataset: { id: 'timer', displayStyle: 'letters' },
    querySelector: () => canvas };
  const document = { fullscreenElement: card, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const context = vm.createContext({ document, orderCardButtons() {}, updateScreenAwake() {}, window: { addEventListener() {} },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    timers: [timer], drawVisual: (c, t) => draws.push({ c, t }) });
  const start = source.indexOf('  let fallbackFullscreenCard = null;');
  const end = source.indexOf('\n  async function tryEnterNativeFullscreen', start);
  vm.runInContext(source.slice(start, end), context);
  context.returnToBoard = () => {};
  listeners.fullscreenchange();
  listeners.webkitfullscreenchange();
  assert.equal(frames.length, 1);
  assert.equal(draws.length, 0);
  frames.shift()();
  assert.equal(draws.length, 1);
  assert.equal(draws[0].c, canvas);
  assert.equal(draws[0].t.style, 'letters');
  assert.equal(timer.style, 'pro');
  document.fullscreenElement = null;
  listeners.fullscreenchange();
  assert.equal(frames.length, 2);
  frames.shift()();
  frames.shift()();
  assert.equal(draws.length, 2, 'exited card redraws without waiting for a timer tick');
  context.scheduleFullscreenRedraw(card);
  card.isConnected = false;
  frames.shift()();
  assert.equal(draws.length, 2, 'discarded cards are ignored');
});

test('hidden timer still fires reminders and completion while its visual work is skipped', () => {
  const visible = { dataset: { displayStyle: 'bar' } };
  const hidden = { dataset: { displayStyle: 'ring' } };
  const timers = [
    { id: 'visible', style: 'bar', units: 'hms', total0: 1000, completed: true },
    { id: 'hidden', style: 'ring', units: 'hms', total0: 1000, _prevRem: 1000,
      triggers: [{ id: 'reminder', type: 'time', valueTime: 500 }] }
  ];
  let reminders = 0, completions = 0, saves = 0;
  const context = vm.createContext({ timers, grid: {}, currentUser: null, updateScreenAwake() {},
    groupTimerCards: () => new Map([['visible', [visible]], ['hidden', [hidden]]]),
    activeNativeFullscreenElement: () => visible, fallbackFullscreenCard: null,
    getCardUpdateNodes: card => {
      assert.equal(card, visible, 'hidden card must not perform DOM lookups');
      return {};
    },
    fmt: () => '0', remainingForDisplay: () => 0, remainingMs: () => 0,
    visualProgress: () => 1, currentAccentColor: () => ({}), updateCardVisuals() {},
    crossedTime: (before, after, threshold) => before > threshold && after <= threshold,
    fireAction: () => reminders++, tone: () => completions++,
    updateAndSaveTimers: () => saves++, timerLoopsEnabled: () => false,
    setTimeout() {}, clamp: n => n
  });
  const start = source.indexOf('  function tick(){');
  const end = source.indexOf('\n  if (settingsBtn)', start);
  vm.runInContext(source.slice(start, end), context);
  context.tick();
  assert.equal(reminders, 1);
  assert.equal(completions, 1);
  assert.equal(saves, 1);
  assert.equal(timers[1].completed, true);
  assert.equal(timers[1]._prevRem, 0);
});
