# AI Context And Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make formal AI queries reliable, context-aware, persistent across restarts, and able to use editable personal and organization memories.

**Architecture:** The backend stores user-scoped conversations and personal/organization memories. The Electron main process performs bounded local fact retrieval, passes only verified facts to the model, and preserves the existing confirmation gates for writes. The renderer restores the latest conversation and exposes a simple memory manager.

**Tech Stack:** Electron, CommonJS, Node.js, Express, JSON persistence, vanilla JavaScript.

---

### Task 1: Bound model calls and repair resident queries

**Files:**
- Modify: `backend/src/services/aiService.js`
- Modify: `app/src/main/ai-router.js`
- Modify: `app/src/main/ai-assistant-service.js`
- Test: `app/tests/main/ai-assistant-service.test.js`

- [x] Add failing tests for resident overview, bounded related facts, full conversation forwarding, and visible online errors.
- [x] Make every online request use explicit temperature and maximum output tokens.
- [x] Disable DeepSeek thinking for supported V4 models.
- [x] Remove the full-database branch and cap retrieved facts.
- [x] Add a local resident overview answer and preserve recent conversation for general chat.
- [x] Run the focused main-process tests.

### Task 2: Add backend conversation and memory storage

**Files:**
- Create: `backend/src/services/aiAssistantStateService.js`
- Modify: `backend/src/database.js`
- Modify: `backend/src/routes/aiRoutes.js`
- Test: `backend/tests/admin-console.test.js`

- [x] Add failing API tests for private conversations, personal memories, shared unit rules, authorization, and deletion.
- [x] Add persistent collections and sanitized service methods.
- [x] Add authenticated assistant state routes.
- [x] Run backend tests.

### Task 3: Connect Electron and add memory management UI

**Files:**
- Modify: `app/src/shared/ipc-contract.js`
- Modify: `app/src/main/ipc-handlers.js`
- Modify: `app/src/preload/index.js`
- Modify: `app/src/main/ai-assistant-service.js`
- Modify: `app/src/renderer/js/ai-settings-ui.js`
- Modify: `app/src/renderer/style.css`
- Test: `app/tests/main/ipc-handlers.test.js`
- Test: `app/tests/preload/ipc-contract.test.js`
- Test: `app/tests/renderer/ai-settings-ui.test.js`

- [x] Persist and restore each account's latest conversation.
- [x] Add explicit personal-memory commands and confirmed unit-rule commands.
- [x] Include applicable memories in the model context.
- [x] Add a memory button, scope labels, and delete controls.
- [x] Run focused IPC and renderer tests.

### Task 4: Verify the development application

**Files:**
- Verify all files changed above.

- [x] Run backend and application test suites.
- [x] Run syntax and whitespace checks.
- [x] Confirm the development watcher restarted both processes.
- [x] Report the new user workflow without packaging or installing.
