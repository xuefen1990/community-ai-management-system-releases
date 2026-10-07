# Household Member Registration Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Keep the existing working tree and development database isolated; do not package, install, commit, or publish.

**Goal:** Add a fast newborn-registration flow inside the household 360° ledger that creates one authoritative resident record, inherits the current household data, blocks duplicate identity cards, and updates the open household immediately.

**Architecture:** A focused main-process domain module owns household context, validation, atomic resident creation, and existing-resident movement. A renderer module mounts into reviewed hooks in the v2.6.4 household dialog, replaces only the right detail pane while active, and calls the existing authenticated `businessRequest` bridge. The existing personnel store remains authoritative and refreshes the dialog after each successful save.

**Tech Stack:** Electron, CommonJS main process, Vue 3 reference renderer with a reviewed bundle adapter, native DOM extension modules, Node test runner.

---

### Task 1: Household registration domain

**Files:**
- Create: `app/src/main/foundation-household-member-registration.js`
- Modify: `app/src/main/foundation-business-service.js`
- Test: `app/tests/main/foundation-household-member-registration.test.js`

- [ ] Add `householdRegistrationContext(database, householdId)` that resolves the derived household, head, members, inherited group/address/status, and a content revision.
- [ ] Add `registerHouseholdMember(database, householdId, body, context)` with two explicit modes:
  - `create`: require a valid Chinese identity card, derive birth date and gender, require name and relationship, inherit household fields, create through the existing personnel model, and add readable operation records.
  - `move-existing`: require the exact resident id/version and an explicit move confirmation when the resident belongs to another household; retain all unrelated resident data.
- [ ] Reject duplicate identity cards, stale household/member revisions, a second household head, and invalid input with Chinese messages.
- [ ] Route `GET /households/:id/member-registration` and `POST /households/:id/members` through `FoundationBusinessService` under existing personnel authorization.
- [ ] Verify focused tests fail before implementation and pass afterward.

### Task 2: Household dialog registration UI

关系下拉框通过 `/api/v3/dictionaries?category=household_relation` 读取系统设置中的自定义关系，并与基础关系及该户历史关系合并。

**Files:**
- Create: `app/src/renderer/foundation/household-member-registration.mjs`
- Modify: `app/src/renderer/foundation/bootstrap.mjs`
- Modify: `scripts/foundation-adaptations.cjs`
- Modify: `app/src/renderer/foundation/foundation.css`
- Test: `app/tests/renderer/household-member-registration.test.js`

- [ ] Install one global factory before the Vue app mounts.
- [ ] Add reviewed adapter hooks for “＋ 添加家庭成员”, the embedded right-pane mount point, “编辑当前成员”, and “关联其他户号”.
- [ ] Render the compact form with identity card first, automatic birth/gender/age display, required name and relationship, inherited household summary, optional fields, and Chinese inline errors.
- [ ] Check a complete valid identity card against `/people`; if it exists, show the exact existing resident and switch the primary action to the reviewed move flow instead of creating a duplicate.
- [ ] Provide “取消”, “保存并继续添加”, and “保存并完成”. Disable repeat submission and restore the selected-member pane on cancel/finish.
- [ ] Add a short transition that respects reduced-motion settings and keeps the existing dialog dimensions.

### Task 3: Refresh, continuity, and safety checks

**Files:**
- Modify: `app/src/renderer/foundation/household-member-registration.mjs`
- Modify: `app/tests/renderer/household-member-registration.test.js`
- Modify: `app/tests/main/foundation-household-member-registration.test.js`

- [ ] After save, emit the dialog’s existing `refresh` event and verify the new member, household population, resident total, and operation record are all based on the same saved record.
- [ ] For “保存并继续添加”, reload the authoritative household context, clear only member-specific inputs, and keep the form open.
- [ ] Verify invalid cards, duplicates, concurrent edits, repeat clicks, and cancelled existing-resident moves do not change data.

### Task 4: Development-mode verification

**Files:**
- Verify only; no production package files.

- [ ] Regenerate `foundation-runtime.mjs` from the original reviewed bundle and the adapter.
- [ ] Run syntax checks, focused main/renderer tests, `git diff --check`, and the full `npm test` suite.
- [ ] In the running Electron development app, open a household, confirm the new button and labels, enter a synthetic valid identity card without saving real resident data, and verify automatic birth/gender plus the inherited household summary.
- [ ] Confirm the production package/version and formal data were not changed.
