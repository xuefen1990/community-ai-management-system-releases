'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { selectSettingsTab } = require('../../src/renderer/js/settings-tab-ui');

function element(dataset = {}) {
  const classes = new Set();
  return {
    dataset,
    attributes: {},
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, enabled) => classes[enabled ? 'add' : 'delete'](name),
    },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

test('settings tabs only show their matching cards and highlight the selected tab', () => {
  const basicButton = element({ settingsTab: 'basic' });
  const lanButton = element({ settingsTab: 'lan' });
  const basicCard = element({ settingsSection: 'basic' });
  const lanCard = element({ settingsSection: 'lan' });
  const logsPanel = element();

  assert.equal(selectSettingsTab('lan', {
    buttons: [basicButton, lanButton],
    cards: [basicCard, lanCard],
    logsPanel,
  }), true);
  assert.equal(basicButton.classList.contains('active'), false);
  assert.equal(lanButton.classList.contains('active'), true);
  assert.equal(basicButton.attributes['aria-selected'], 'false');
  assert.equal(lanButton.attributes['aria-selected'], 'true');
  assert.equal(basicCard.classList.contains('hidden'), true);
  assert.equal(lanCard.classList.contains('hidden'), false);
  assert.equal(logsPanel.classList.contains('hidden'), true);
});

test('operation logs are displayed through the same settings tab switcher', () => {
  const logsButton = element({ settingsTab: 'logs' });
  const basicCard = element({ settingsSection: 'basic' });
  const logsPanel = element();

  selectSettingsTab('logs', { buttons: [logsButton], cards: [basicCard], logsPanel });
  assert.equal(logsButton.classList.contains('active'), true);
  assert.equal(basicCard.classList.contains('hidden'), true);
  assert.equal(logsPanel.classList.contains('hidden'), false);
});

test('settings page loads the tab switcher through the existing renderer adapter', async () => {
  const appRoot = path.resolve(__dirname, '..', '..');
  const html = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const adapter = await fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'ai-settings-ui.js'), 'utf8');
  const rendererIndex = html.indexOf('<script src="renderer.js"></script>');
  const adapterIndex = html.indexOf('<script src="js/ai-settings-ui.js"></script>');
  assert.ok(rendererIndex >= 0);
  assert.ok(adapterIndex > rendererIndex);
  assert.match(adapter, /settings-tab-ui\.js/u);
});
