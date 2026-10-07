'use strict';

// Display branding may change; Electron's OS encryption namespace must not.
// On macOS safeStorage uses `${app.getName()} Safe Storage` in the Keychain.
// Keeping this identity also preserves updater/cache names across the rename.
const PRODUCT_DISPLAY_NAME = '村居AI管理系统';
const PRODUCT_STORAGE_IDENTITY = '社区AI管理系统';

module.exports = { PRODUCT_DISPLAY_NAME, PRODUCT_STORAGE_IDENTITY };
