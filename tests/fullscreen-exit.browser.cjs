// Run with Playwright installed: node tests/fullscreen-exit.browser.cjs
// Optional: BROWSER_ENGINE=webkit, BROWSER_EXECUTABLE=/path/to/browser
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.TEST_ROOT || path.join(__dirname, '..');
const expose = `window.fullscreenTest = {
  set(list) { timers = list.map(migrateTimer); render(); },
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
    const base = { name: 'Layout regression', mode: 'duration', duration: 3600000,
      total0: 3600000, start: Date.now() - 900000, color: '#6c7bff', color2: '#ff0000',
      units: 'hms', tick: 16, ms: 'off', triggers: [], loopConfig: { enabled: false } };
    let cycles = 0;
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      // Include Pro's separate cards, a paused timer, and a neighbouring card.
      for (const style of ['letters', 'ring', 'pie', 'multibar', 'pro']) {
        for (const fallback of [false, true]) {
          await page.evaluate(({ base, style }) => fullscreenTest.set([
            { ...base, id: 'first', style, paused: true, leftWhenPaused: 2700000 },
            { ...base, id: 'neighbour', style: 'ring' }
          ]), { base, style });
          if (fallback) await page.evaluate(() => fullscreenTest.fallback(true));
          const cards = page.locator('.card[data-id="first"]');
          const count = await cards.count();
          for (let i = 0; i < count; i++) {
            const card = cards.nth(i);
            // Ignore document scroll: compare canvas placement relative to its card.
            const geometry = () => card.evaluate(el => {
              const r = el.getBoundingClientRect();
              const c = el.querySelector('canvas');
              const v = (c || el.querySelector('.progressbar,.split-color-preview')).getBoundingClientRect();
              let painted = 0;
              if (c) {
                const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                for (let j = 3; j < data.length; j += 4) if (data[j]) painted++;
              }
              return { x: v.x-r.x, y: v.y-r.y, width: v.width, height: v.height,
                cardWidth: r.width, cardHeight: r.height, painted,
                backingWidth: c?.width, backingHeight: c?.height };
            });
            await page.waitForTimeout(300);
            const before = await geometry();
            for (const exit of ['button', 'escape']) {
              await card.locator('[data-act="fullscreen"]').click();
              await page.waitForFunction(() => !!document.fullscreenElement || !!document.webkitFullscreenElement || !!document.querySelector('.fullscreen-fallback'));
              await page.waitForTimeout(300);
              const native = await page.evaluate(() => !!document.fullscreenElement || !!document.webkitFullscreenElement);
              const full = await geometry();
              assert.ok(full.width > before.width, 'animation expands in fullscreen');
              if (full.backingWidth) assert.ok(full.painted > 0, 'fullscreen canvas is painted');
              if (exit === 'button') await card.locator('[data-act="fullscreen"]').click();
              else if (!native) await page.keyboard.press('Escape');
              // Headless browsers do not implement the browser-level Escape shortcut.
              else await page.evaluate(() => (document.exitFullscreen || document.webkitExitFullscreen).call(document));
              await page.waitForFunction(() => !document.fullscreenElement && !document.webkitFullscreenElement && !document.querySelector('.fullscreen-fallback'));
              await page.waitForTimeout(300);
              const after = await geometry();
              for (const key of ['x', 'y', 'width', 'height', 'cardWidth', 'cardHeight', 'backingWidth', 'backingHeight']) {
                if (before[key] !== undefined) assert.ok(Math.abs(before[key]-after[key]) <= 1,
                  JSON.stringify({ size, style, fallback, i, exit, key, before, after }));
              }
              if (after.backingWidth) assert.ok(after.painted > 0, 'restored canvas is painted');
              cycles++;
            }
          }
          console.log(`PASS ${size.width}x${size.height} ${style} ${fallback ? 'CSS fallback' : 'native request'}`);
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${cycles} fullscreen exits: restored geometry and painted canvases, no browser errors`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
