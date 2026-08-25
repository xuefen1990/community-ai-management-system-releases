# Unit Application Form Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unit application form comfortable to use in a normal desktop window while keeping both application flows unchanged.

**Architecture:** `local-auth-ui.js` will give the dynamic application panel semantic layout classes and separate scrolling fields from fixed actions. `style.css` will contain styles scoped to `.unit-application-panel`; the existing login screen stays unchanged. A renderer test will protect the layout hooks and responsive rule.

**Tech Stack:** Electron renderer, vanilla JavaScript, CSS, Node.js built-in test runner.

---

### Task 1: Define the layout contract in a renderer test

**Files:**

- Modify: `app/tests/renderer/local-auth-ui.test.js`

- [ ] **Step 1: Add a failing source-level test after `local authentication UI uses only the preload bridge`**

```js
test('unit application panel separates scrollable fields from fixed actions', async () => {
  const [source, style] = await Promise.all([
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'js', 'local-auth-ui.js'), 'utf8'),
    fs.readFile(path.join(appRoot, 'src', 'renderer', 'style.css'), 'utf8'),
  ]);
  assert.match(source, /unit-application-panel/u);
  assert.match(source, /unit-application-scroll/u);
  assert.match(source, /unit-application-actions/u);
  assert.match(source, /unit-application-passwords/u);
  assert.match(style, /\.unit-application-panel\s*\{/u);
  assert.match(style, /\.unit-application-scroll\s*\{/u);
  assert.match(style, /\.unit-application-actions\s*\{/u);
  assert.match(style, /@media\s*\(max-width:\s*640px\)/u);
});
```

- [ ] **Step 2: Run `node --test app/tests/renderer/local-auth-ui.test.js`**

Expected: FAIL because the application panel currently has no scoped layout classes.

### Task 2: Rebuild the dynamic application panel with layout boundaries

**Files:**

- Modify: `app/src/renderer/js/local-auth-ui.js:261-283`

- [ ] **Step 1: Keep all existing input IDs, values, listeners and submit behavior, but replace the dynamic markup with these groups**

```html
<div class="unit-application-heading">…existing logo, title and subtitle…</div>
<div class="unit-application-kind">…existing two application-kind radios…</div>
<div class="unit-application-scroll">
  …name, phone, passwords, unit fields/member invite and regErrorContainer…
</div>
<div class="unit-application-actions">
  <button id="backToLoginBtn" type="button">返回登录</button>
  <button id="doRegisterBtn" type="button">提交申请</button>
</div>
```

Add `unit-application-panel` to `#panel-register`, and use `unit-application-passwords` to group password and confirmation fields.

- [ ] **Step 2: Run `node --test app/tests/renderer/local-auth-ui.test.js`**

Expected: PASS.

### Task 3: Add scoped desktop and responsive styles

**Files:**

- Modify: `app/src/renderer/style.css` near the existing `.auth-panel` styles

- [ ] **Step 1: Add the approved layout styles**

```css
.unit-application-panel { display:flex; flex-direction:column; max-height:min(760px, calc(100vh - 150px)); }
.unit-application-panel .login-header { margin-bottom:18px; }
.unit-application-kind { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px; }
.unit-application-scroll { overflow-y:auto; padding-right:6px; }
.unit-application-panel .input-group { margin-bottom:14px; }
.unit-application-passwords { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.unit-application-actions { display:grid; grid-template-columns:1fr 1.35fr; gap:10px; padding-top:14px; margin-top:auto; border-top:1px solid var(--border-color); background:var(--bg-card); }
@media (max-width:640px) { .unit-application-passwords, .unit-application-kind, .unit-application-actions { grid-template-columns:1fr; } }
```

Use current theme variables and button classes. Do not change global `.login-form` styles.

- [ ] **Step 2: Run `node --test app/tests/renderer/local-auth-ui.test.js`**

Expected: PASS.

### Task 4: Verify, commit, push, and package

**Files:**

- Verify: `app/src/renderer/js/local-auth-ui.js`
- Verify: `app/src/renderer/style.css`
- Verify: `app/tests/renderer/local-auth-ui.test.js`

- [ ] **Step 1: Run `node --check app/src/renderer/js/local-auth-ui.js && npm test --prefix app && git diff --check`**

Expected: syntax check and all desktop tests pass; whitespace check has no output.

- [ ] **Step 2: Run `git status --short` and inspect the three implementation file diffs**

Expected: only this feature's implementation files are staged; unrelated user changes remain unstaged.

- [ ] **Step 3: Run the following delivery commands**

```bash
git add app/src/renderer/js/local-auth-ui.js app/src/renderer/style.css app/tests/renderer/local-auth-ui.test.js
git commit -m "feat: improve unit application layout"
git push origin HEAD
npm run build:arm64 --prefix app
shasum -a 256 app/release/社区AI管理系统-0.3.11-arm64.dmg
```

Expected: the commit and push succeed; a refreshed Apple-silicon DMG and SHA-256 are available for delivery.
