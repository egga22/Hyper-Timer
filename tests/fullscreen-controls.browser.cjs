// Run with Playwright installed: node tests/fullscreen-exit.browser.cjs
// Optional: BROWSER_ENGINE=webkit, BROWSER_EXECUTABLE=/path/to/browser
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.TEST_ROOT || path.join(__dirname, '..');
const expose = `window.fullscreenTest = {
  set(list) { timers = list.map(migrateTimer); render(); },
  edit(id) { openEditor(id); },
  read() { return timers; },
  fallback(on) { document.querySelectorAll('.card').forEach(card => {
    card.requestFullscreen = on ? () => Promise.reject(new Error('Test CSS fallback')) : undefined;
  }); }
};`;

(async () => {
  const engine = process.env.BROWSER_ENGINE === 'webkit' ? webkit : chromium;
  const browser = await engine.launch({ headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (url.hostname !== 'hypertimer.test' || !['index.html', 'script.js', 'style.css', 'sw.js'].includes(name)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      let body = fs.readFileSync(path.join(root, name), 'utf8');
      if (name === 'script.js') body = body.replace('  registerServiceWorker();', expose + '\n  registerServiceWorker();');
      return route.fulfill({ body, contentType: name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('https://hypertimer.test');
    await page.waitForFunction(() => !!window.fullscreenTest);
    await page.locator('#settingsBtn').click();
    const settings = page.locator('#settingsFullscreenControls');
    assert.ok(await settings.isVisible());
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const options = settings.locator('label');
      assert.equal(await options.count(), 6);
      assert.ok(await options.first().isVisible());
      assert.ok(await settings.evaluate(el => el.scrollWidth <= el.clientWidth));
      if (process.env.SETTINGS_SCREENSHOTS) await page.screenshot({ path: `/tmp/hyper-settings-${width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await settings.locator('[value="pause"]').check();
    await settings.locator('[value="duplicate"]').check();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('#settingsBtn').click();
    assert.ok(await settings.locator('[value="pause"]').isChecked());
    await page.keyboard.press('Escape');
    await page.evaluate(() => fullscreenTest.set([{ id: 'test', name: 'Controls', mode: 'duration', style: 'bar', duration: 60000, total0: 60000, start: Date.now(), units: 'hms', color: '#6c7bff', triggers: [] }]));
    for (const fallback of [false, true]) {
      await page.evaluate(on => fullscreenTest.fallback(on), fallback);
      await page.locator('[data-act="fullscreen"]').click();
      assert.ok(await page.locator('[data-act="pause"]').isVisible());
      assert.ok(await page.locator('[data-act="duplicate"]').isVisible());
      assert.equal(await page.locator('[data-act="delete"]').isVisible(), false);
      await page.locator('[data-act="fullscreen"]').click();
    }
    await page.evaluate(() => fullscreenTest.edit('test'));
    await page.locator('#f_fullscreenOverride').selectOption('custom');
    await page.locator('#timerFullscreenControls [value="pause"]').uncheck();
    await page.locator('#timerFullscreenControls [value="duplicate"]').uncheck();
    await page.locator('#saveBtn').click();
    if (await page.locator('#saveAnimationDialog').isVisible()) await page.locator('#saveAnimationDialog [value="continue"]').click();
    await page.waitForFunction(() => !document.querySelector('#editor').open);
    assert.deepEqual(await page.evaluate(() => fullscreenTest.read()[0].fullscreenControls), []);
    await page.reload();
    await page.waitForFunction(() => !!window.fullscreenTest);
    assert.deepEqual(await page.evaluate(() => fullscreenTest.read()[0].fullscreenControls), []);
    await page.evaluate(() => fullscreenTest.fallback(true));
    await page.locator('[data-act="fullscreen"]').click();
    assert.equal(await page.locator('[data-act="pause"]').isVisible(), false);
    assert.ok(await page.locator('[data-act="fullscreen"]').isVisible());
    assert.deepEqual(errors, []);
    console.log('PASS settings persistence, native/fallback visibility, and saved per-timer override');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
