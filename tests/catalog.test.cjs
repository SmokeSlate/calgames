const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const entry = { id: '3', title: '<em data-inert="title">Literal title</em>', author: '<b data-inert="author">Literal author</b>', description: '<strong>Supported emphasis</strong><br><span data-inert="description">Plain text</span>', image: 'javascript:inert', fileUpload: ['/game.8xp'] };
async function page(file, route = '/') {
  const w = new JSDOM(fs.readFileSync(file, 'utf8'), { url: 'https://calgames.test' + route, runScripts: 'outside-only' }).window;
  w.fetch = async () => ({ ok: true, json: async () => [entry] });
  w.particlesJS = () => {};
  w.console.error = () => {};
  const shared = 'public/assets/js/catalog.js';
  if (fs.existsSync(shared)) w.eval(fs.readFileSync(shared, 'utf8'));
  for (const script of w.document.querySelectorAll('script:not([src])')) w.eval(script.textContent);
  await tick();
  return w;
}
test('home, library and detail render submitted titles/authors as text and reject unsafe image schemes', async () => {
  for (const [file, route, selector] of [['public/index.html', '/', '#games-container'], ['public/games/index.html', '/games/', '#games-list'], ['public/games/detail/index.html', '/games/detail/?id=3', '#game-info']]) {
    const w = await page(file, route);
    const root = w.document.querySelector(selector);
    assert.equal(root.querySelector('[data-inert]'), null);
    assert.ok(root.textContent.includes(entry.title));
    for (const image of w.document.querySelectorAll('img')) assert.equal(Boolean(image.getAttribute('src')?.startsWith('javascript:')), false);
    if (route.includes('detail')) assert.ok(root.querySelector('strong'));
    w.close();
  }
});
test('failed authoritative load blocks any subsequent PUT', async () => {
  const w = await page('public/admin/reorder.html');
  let puts = 0;
  w.prompt = () => 'synthetic'; w.alert = () => {};
  w.fetch = async (_url, init) => { if (init?.method === 'PUT') puts++; return { ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) }; };
  await w.loadGames();
  await w.updateGitHubFile();
  assert.equal(puts, 0);
  w.close();
});
test('description submission and detail allow safe formatting while removing unsupported markup and attributes', async () => {
  const w = await page('public/tools/submit/index.html');
  const script = fs.readFileSync('public/assets/js/submit.js', 'utf8');
  const start = script.indexOf('function formatDescriptionForListing(');
  const end = script.indexOf('function generateNextGameId(', start);
  w.eval(script.slice(start, end));
  const rendered = w.document.createElement('div');
  rendered.innerHTML = w.formatDescriptionForListing(entry.description + '\nSecond line');
  assert.ok(rendered.querySelector('strong'));
  assert.ok(rendered.querySelector('br'));
  assert.equal(rendered.querySelector('[data-inert]'), null);
  assert.match(rendered.textContent, /Plain text/);
  w.close();
});
test('detail download controls support download-only, uploader-only and unavailable entries', async () => {
  const w = await page('public/games/detail/index.html', '/games/detail/?id=3');
  for (const [data, downloads, uploaders] of [[{ download: 'https://files.test/game.zip' },1,0], [{ fileUpload: ['/game.8xp'] },0,1], [{},0,0], [{ download: 'javascript:inert' },0,0]]) {
    const root = w.document.createElement('div');
    root.innerHTML = w.buildButtonGroup({ title: 'Game', ...data });
    assert.equal([...root.querySelectorAll('a')].filter(a => a.textContent === 'Download game').length, downloads);
    assert.equal([...root.querySelectorAll('a')].filter(a => a.textContent === 'Load in uploader').length, uploaders);
    assert.equal(root.querySelector('a[href="undefined"]'), null);
  }
  w.close();
});
test('reorder uses GitHub content and SHA together, preserves drafts on rejection and never reports false success', async () => {
  for (const status of [401,403,409,422]) {
    const w = await page('public/admin/reorder.html');
    const messages = [];
    const puts = [];
    w.prompt = () => 'synthetic';
    w.alert = message => messages.push(message);
    w.fetch = async (_url, init) => {
      if (init?.method === 'PUT') { puts.push(JSON.parse(init.body)); return { ok: false, status, json: async () => ({ message: 'Rejected' }) }; }
      return { ok: true, status: 200, json: async () => ({ sha: 'loaded-sha', content: Buffer.from(JSON.stringify([entry,{id:'4',title:'New game',author:'New author'}])).toString('base64'), encoding:'base64' }) };
    };
    await w.loadGames();
    await tick();
    assert.equal(w.document.querySelector('#game-list [data-inert]'), null);
    await w.updateGitHubFile();
    await tick();
    assert.equal(puts[0].sha, 'loaded-sha');
    assert.equal(JSON.parse(Buffer.from(puts[0].content, 'base64')).length, 2);
    assert.equal(messages.some(message => /successfully/.test(message)), false);
    assert.ok(messages.some(message => /Rejected|failed|rejected/i.test(message)));
    w.close();
  }
});
