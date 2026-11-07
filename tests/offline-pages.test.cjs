const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const read = file => process.env.BASELINE ? cp.execFileSync('git', ['show', 'main:' + file], { encoding: 'utf8' }) : fs.readFileSync(file, 'utf8');
const fixture = { id: '3', title: 'Synthetic game', author: 'Author', description: 'Description', image: '/image.png', fileUpload: ['/one.8xp'] };
async function page(file, route, particles) {
  const w = new JSDOM(read(file), { url: 'https://calgames.test' + route, runScripts: 'outside-only' }).window;
  w.console.warn = () => {};
  w.console.error = () => {};
  w.alert = () => {};
  if (particles === 'noop') w.particlesJS = () => {};
  else if (particles) w.particlesJS = () => { throw new Error('optional CDN failed'); };
  const calls = [];
  w.fetch = async url => { calls.push(String(url)); return { ok: true, json: async () => [fixture] }; };
  const frame = w.document.getElementById('uploader-frame');
  if (frame) frame.contentWindow.transferTool = { getState: () => ({}), loadFileFromArrayBuffer: () => ({ success: true }) };
  if (fs.existsSync('public/assets/js/catalog.js')) w.eval(fs.readFileSync('public/assets/js/catalog.js', 'utf8'));
  for (const script of w.document.querySelectorAll('script:not([src])')) w.eval(script.textContent);
  await tick();
  return { w, calls };
}
for (const throwing of [false, true]) test('core pages initialize when particles are ' + (throwing ? 'throwing' : 'absent'), async () => {
  for (const [file, route] of [['public/games/index.html', '/games/'], ['public/games/detail/index.html', '/games/detail/?id=3'], ['public/contact/index.html', '/contact/'], ['public/downloads/index.html', '/downloads/']]) {
    const { w, calls } = await page(file, route, throwing);
    if (route.startsWith('/games/detail')) assert.equal(w.document.getElementById('hero-title').textContent, fixture.title);
    else if (route === '/games/') { assert.ok(calls.includes('/games/games.json')); assert.match(w.document.getElementById('games-list').textContent, /Synthetic game/); }
    else if (route === '/contact/') {
      const event = new w.Event('submit', { cancelable: true });
      w.document.getElementById('contactForm').dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
    }
    await tick();
    w.close();
  }
});
test('uploader preserves literal percent/Unicode titles and all four individual files without a misleading bulk load', async () => {
  for (const title of ['100%', '%20 literal', 'Café']) {
    const files = ['/one.8xp', '/two.8xv', '/three.8xv', '/four.8xv'];
    const { w } = await page('public/tools/uploader/index.html', '/tools/uploader/?title=' + encodeURIComponent(title) + '&files=' + encodeURIComponent(JSON.stringify(files)), 'noop');
    assert.match(w.document.getElementById('uploader-title').textContent, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(w.document.querySelectorAll('.file-entry').length, 4);
    assert.equal(w.document.querySelectorAll('#file-controls button').length, 0);
    assert.match(w.document.getElementById('file-controls').textContent, /one file at a time/);
    w.close();
  }
});
