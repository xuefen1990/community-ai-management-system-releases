'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { printDisbursementPages } = require('../../src/main/disbursement-print-service');

test('direct print submits every preview page with the selected printer and paper', async () => {
  const calls = [];
  class PrintWindow {
    constructor(options) {
      calls.push(['window', options]);
      this.webContents = {
        executeJavaScript: async (script) => { calls.push(['fonts', script]); },
        print: (options, done) => { calls.push(['print', options]); done(true); },
      };
    }
    async loadURL(url) { calls.push(['load', decodeURIComponent(url)]); }
    isDestroyed() { return false; }
    destroy() { calls.push(['destroy']); }
  }
  const result = await printDisbursementPages({ BrowserWindow: PrintWindow, printers: [{ name: 'device-1', displayName: 'Office printer' }], value: {
    printerName: 'device-1', paper: 'A5', orientation: 'landscape', pageCount: 2,
    html: '<html><head></head><body><article class="wb-sheet">1</article><article class="wb-sheet">2</article></body></html>',
  } });
  assert.deepEqual(result, { ok: true, printerName: 'device-1', pageCount: 2 });
  assert.equal(calls.find((call) => call[0] === 'window')[1].show, false);
  assert.match(calls.find((call) => call[0] === 'load')[1], /Content-Security-Policy/u);
  assert.deepEqual(calls.find((call) => call[0] === 'print')[1], { silent: true, deviceName: 'device-1', pageSize: 'A5', landscape: true, margins: { marginType: 'none' }, printBackground: true });
  assert.equal(calls.at(-1)[0], 'destroy');
});

test('direct print rejects an unavailable printer or missing preview pages', async () => {
  const config = { BrowserWindow: class {}, printers: [{ name: 'device-1' }], value: { printerName: 'device-2', paper: 'A4', orientation: 'portrait', pageCount: 2, html: '<article class="wb-sheet">1</article>' } };
  await assert.rejects(() => printDisbursementPages(config), /不可用/u);
  config.value.printerName = 'device-1';
  await assert.rejects(() => printDisbursementPages(config), /页数.*不一致/u);
});
