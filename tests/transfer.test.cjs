const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('public/tools/transfer/index.html', 'utf8');
const script = new JSDOM(html).window.document.querySelector('script:not([src])').textContent;
function library() {
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, console: { debug() {} }, navigator: {} });
  const marker = script.indexOf('\t}(() => {');
  assert.ok(marker > 0);
  vm.runInContext(script.slice(0, marker) + '\t} globalThis.library = n(918); })();', context);
  return context.library;
}
const parser = library().tifiles;
const valid = new Uint8Array(fs.readFileSync('public/games/dls/OIRAM.8xp'));
function checksum(bytes) {
  const end = bytes.length - 2;
  const sum = bytes.slice(55, end).reduce((sum, byte) => (sum + byte) & 65535, 0);
  bytes[end] = sum & 255; bytes[end + 1] = sum >> 8;
}
test('all tracked calculator program/appvar files remain valid', () => {
  const files = require('node:child_process').execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(file => /\.(8xp|8xv)$/i.test(file));
  assert.ok(files.length >= 87);
  for (const file of files) assert.equal(parser.isValid(parser.parseFile(new Uint8Array(fs.readFileSync(file)))), true, file);
});
for (const [name, corrupt] of [
  ['checksum', bytes => { bytes[bytes.length - 1] ^= 1; }],
  ['signature', bytes => { bytes[8] = 0; }],
  ['duplicate entry length', bytes => { bytes[55 + 15] ^= 1; checksum(bytes); }],
  ['entry bounds', bytes => { bytes[55 + 2] = 255; bytes[55 + 3] = 255; checksum(bytes); }],
]) test('rejects corrupt ' + name + ' before transfer readiness', () => {
  const bytes = valid.slice(); corrupt(bytes);
  assert.equal(parser.isValid(parser.parseFile(bytes)), false);
});
test('USB connect callback passes the event device through discovery and emits its result', async () => {
  const expression = script.match(/navigator\.usb\.addEventListener\("connect", (\(async e => \{[\s\S]*?\}\))\)/)[1];
  const device = { serialNumber: 'synthetic' };
  const calculator = { name: 'Synthetic calculator', device };
  const emitted = [];
  const context = vm.createContext({ _: async actual => { assert.equal(actual, device); return calculator; }, u: { connect: [value => emitted.push(value)] }, console: { debug() {} } });
  const callback = vm.runInContext(expression, context);
  await callback({ device });
  await callback({ device });
  assert.deepEqual(emitted, [calculator, calculator]);
});
test('invalid files clear the actual transfer bridge ready state', async () => {
  const w = new JSDOM(html, { url: 'https://calgames.test/tools/transfer/', runScripts: 'outside-only' }).window;
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  w.console.debug = () => {};
  w.eval(script);
  assert.equal(w.transferTool.loadFileFromArrayBuffer(valid.buffer.slice(valid.byteOffset, valid.byteOffset + valid.byteLength), { name: 'Synthetic.8xp' }).success, true);
  assert.equal(w.transferTool.getState().hasFile, true);
  const corrupt = valid.slice(); corrupt[corrupt.length - 1] ^= 1;
  assert.equal(w.transferTool.loadFileFromArrayBuffer(corrupt.buffer).success, false);
  assert.equal(w.transferTool.getState().hasFile, false);
  await new Promise(resolve => setImmediate(resolve));
  w.close();
});
