const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const user = { id: 'test-account', email: 'timers@example.test', role: 'owner' };
const timer = (id, name, fields) => ({
  id, name, mode: 'duration', style: 'bar', color: '#6c7bff', units: 'auto',
  start: Date.now(), duration: 86400000, total0: 86400000, triggers: [], ...fields
});

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE });
  let remote = {
    Role: 'owner',
    last_modified: '2026-11-10T10:00:00.000Z',
    timers: [timer('a', 'Laptop edits'), timer('b', 'New on laptop')]
  };
  let writes = 0;
  let deny = false;
  let patchGet = null;
  try {
    const phone = await browser.newContext({ serviceWorkers: 'block' });
    await phone.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'sync-check.test') {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        return route.fulfill({
          body: fs.readFileSync(path.join(root, file)),
          contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'
        });
      }
      if (url.pathname.endsWith('/accounts/test-account')) {
        if (deny) return route.fulfill({ status: 503, json: {} });
        if (route.request().method() === 'PATCH') {
          writes++;
          Object.assign(remote, route.request().postDataJSON());
        } else if (patchGet) {
          patchGet.count++;
          if (patchGet.count === 2) patchGet.action();
        }
        return route.fulfill({ json: remote });
      }
      return route.fulfill({ status: 404 });
    });
    const page = await phone.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.goto('https://sync-check.test', { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ user, board }) => {
      localStorage.setItem('hyperTimer_v6_user', JSON.stringify(user));
      localStorage.setItem('hyperTimer_v6_timers', JSON.stringify(board));
      localStorage.setItem('hyperTimer_v6_lastModified', '9999999999999');
    }, { user, board: [
      timer('a', 'Old phone timer'),
      timer('expired', 'Expired only on phone', { start: 1, duration: 1000, total0: 1000 }),
      timer('old-smart', 'Old Smart timer', { mode: 'smart', smartMethod: 'manifold', targetMs: Date.now() + 1000, smartUrl: 'https://market.test/old' })
    ] });
    await page.reload();
    await page.getByText('New on laptop', { exact: true }).waitFor();
    assert.equal(writes, 0, 'first sync must never upload a legacy cache');
    assert.equal(await page.getByText('Expired only on phone').count(), 0);

    await page.locator('#settingsBtn').click();
    await page.locator('#syncRecoveryOpen').click();
    const download = page.waitForEvent('download');
    await page.locator('#syncRecoveryBtn').click();
    const recovery = JSON.parse(fs.readFileSync(await (await download).path()));
    assert.ok(recovery.some(item => item.id === 'expired'), 'legacy cache is recoverable');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    remote = { ...remote, timers: [...remote.timers, timer('later', 'Added from laptop while phone sleeps')] };
    const first = page.locator('.card[data-id="a"] [data-act="pause"]');
    await first.click();
    await page.getByText('Added from laptop while phone sleeps', { exact: true }).waitFor();
    assert.equal(remote.timers.find(item => item.id === 'a').paused, true, 'phone edit is applied');
    assert.ok(remote.timers.some(item => item.id === 'later'), 'laptop-only timer survives the phone write');
    assert.equal(writes, 1);

    deny = true;
    await page.locator('#addBtn').click();
    await page.locator('#f_name').fill('Created offline');
    await page.locator('#saveBtn').click();
    await page.getByText('Created offline', { exact: true }).waitFor();
    await page.locator('#editor').waitFor({ state: 'hidden' });
    const firstWrite = writes;
    deny = false;
    patchGet = { count: 0, action() { remote.timers.push(timer('race', 'Laptop wrote during sync')); } };
    await page.locator('#settingsBtn').click();
    await page.locator('#settingsSyncBtn').click();
    await page.getByRole('button', { name: 'Retry Sync', exact: true }).waitFor();
    assert.equal(writes, firstWrite, 'cloud changes found before PATCH must stop the write');
    patchGet = null;
    await page.locator('#settingsSyncBtn').click();
    await page.getByText('Laptop wrote during sync', { exact: true }).waitFor({ state: 'attached' });
    assert.ok(remote.timers.some(item => item.name === 'Created offline'));
    assert.ok(remote.timers.some(item => item.id === 'race'));
    assert.deepEqual(errors, []);
    console.log('PASS stale phone, downloadable recovery, independent edits, offline queue, and changed-cloud retry');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
