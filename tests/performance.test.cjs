const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
const start = source.indexOf('  const cardUpdateNodes = new WeakMap();');
const end = source.indexOf('\n  function tick()', start);
const context = vm.createContext({ WeakMap, Map });
vm.runInContext(source.slice(start, end), context);

test('one grid scan groups many timers and all Pro split cards, including unusual IDs', () => {
  const cards = Array.from({ length: 100 }, (_, id) => ({ dataset: { id: String(id) } }));
  const split = { dataset: { id: '1' } };
  const unusual = { dataset: { id: 'a"[b]' } };
  cards.push(split, unusual);
  let scans = 0;
  const groups = context.groupTimerCards({ querySelectorAll(selector) {
    scans++;
    assert.equal(selector, '.card[data-id]');
    return cards;
  } });
  assert.equal(scans, 1);
  assert.equal(groups.size, 101);
  assert.equal(groups.get('1').length, 2);
  assert.equal(groups.get('1')[1], split);
  assert.equal(groups.get(unusual.dataset.id)[0], unusual);
});

test('card nodes are reused across updates and rebuilt for replacement cards', () => {
  let queries = 0;
  const makeCard = () => ({ querySelector(selector) { queries++; return { selector }; } });
  const card = makeCard();
  const first = context.getCardUpdateNodes(card);
  for (let i = 0; i < 100; i++) assert.equal(context.getCardUpdateNodes(card), first);
  assert.equal(queries, 3);
  const replacement = context.getCardUpdateNodes(makeCard());
  assert.notEqual(replacement, first);
  assert.notEqual(replacement.txt, first.txt);
  assert.equal(queries, 6);
});
