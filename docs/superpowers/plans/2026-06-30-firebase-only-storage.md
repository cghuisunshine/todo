# Firebase-Only Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the family todo app's remote JSON CRUD backend with Firebase Firestore as the only shared storage backend.

**Architecture:** Keep the standalone `family_todo_login.html` app and preserve the current todo data shape. Add Firebase compat SDK scripts, initialize the fixed Firebase project with an API key from `?apiKey=` or `localStorage.firebaseApiKey`, subscribe to `familyTodo/main` with Firestore `onSnapshot`, and write the full todo payload with `.set(...)`. Update the Node test harness to mock Firebase and assert the old `home.gochatus.org` storage contract is gone.

**Tech Stack:** Standalone HTML/CSS/JavaScript, Firebase App compat SDK, Firebase Firestore compat SDK, Node built-in test runner, Node `vm` test harness.

---

## File Structure

- Modify `family_todo_login.test.mjs`: replace remote JSON contract tests with Firebase-only contract tests; extend the VM harness with fake `firebase`, `location`, `navigator`, and `prompt` objects; update behavior tests to inspect Firestore writes and listener handling.
- Modify `family_todo_login.html`: add Firebase SDK scripts, replace bearer-token settings with Firebase API key settings, remove remote JSON helpers, add Firebase initialization/listener/write helpers, and preserve existing todo rendering and interaction behavior.
- Keep `docs/superpowers/specs/2026-06-30-firebase-only-storage-design.md` unchanged unless implementation reveals a spec mismatch.

---

### Task 1: Firebase Storage Contract Tests

**Files:**
- Modify: `family_todo_login.test.mjs:70-254`
- Read: `docs/superpowers/specs/2026-06-30-firebase-only-storage-design.md`
- Read: `family_todo_login.html`

- [ ] **Step 1: Replace old storage contract tests with Firebase contract tests**

Remove tests that require remote JSON CRUD behavior:

- `uses remote JSON CRUD file storage for family todo data`
- `falls back to the no-port storage endpoint after access failure`
- `times out stuck storage endpoint attempts so fallback can run`
- `creates the remote file when first replace finds no existing file`
- `sends bearer authorization headers from a configurable token`
- `includes hamburger settings controls for token management`

Add tests with this coverage:

```js
test("uses Firebase Firestore as the only shared storage backend", () => {
  assert.match(html, /firebasejs\/9\.23\.0\/firebase-app-compat\.js/);
  assert.match(html, /firebasejs\/9\.23\.0\/firebase-firestore-compat\.js/);
  assert.match(html, /projectId:\s*"homeinventory-4718c"/);
  assert.match(html, /storageBucket:\s*"homeinventory-4718c\.firebasestorage\.app"/);
  assert.match(html, /messagingSenderId:\s*"719884896213"/);
  assert.match(html, /appId:\s*"1:719884896213:web:e93d5dffc79dec10995f5c"/);
  assert.match(html, /FIREBASE_COLLECTION\s*=\s*"familyTodo"/);
  assert.match(html, /FIREBASE_DOC_ID\s*=\s*"main"/);
  assert.match(html, /\.collection\(FIREBASE_COLLECTION\)\.doc\(FIREBASE_DOC_ID\)/);
  assert.match(html, /\.onSnapshot\(/);
  assert.match(html, /\.set\(payload\)/);
});

test("does not use the old remote JSON CRUD service", () => {
  assert.doesNotMatch(html, /home\.gochatus\.org/);
  assert.doesNotMatch(html, /\/files/);
  assert.doesNotMatch(html, /\/usage/);
  assert.doesNotMatch(html, /Authorization/);
  assert.doesNotMatch(html, /Bearer/);
  assert.doesNotMatch(html, /DEFAULT_STORAGE_TOKEN/);
  assert.doesNotMatch(html, /fetchStorage/);
});

test("resolves Firebase API key from URL before localStorage", () => {
  assert.match(html, /new URLSearchParams\(location\.search\)/);
  assert.match(html, /\.get\("apiKey"\)/);
  assert.match(html, /localStorage\.setItem\(FIREBASE_API_KEY_KEY,\s*apiKeyFromUrl\)/);
  assert.match(html, /localStorage\.getItem\(FIREBASE_API_KEY_KEY\)/);
  assert.match(html, /FIREBASE_API_KEY_KEY\s*=\s*"firebaseApiKey"/);
});

test("includes Firebase API key settings controls", () => {
  assert.match(html, /id="menuBtn"/);
  assert.match(html, /id="settingsPanel"/);
  assert.match(html, /id="firebaseKeyInput"/);
  assert.match(html, /id="saveFirebaseKeyBtn"/);
  assert.match(html, /id="testFirebaseBtn"/);
  assert.match(html, /id="clearFirebaseKeyBtn"/);
  assert.match(html, /id="shareFirebaseBtn"/);
  assert.doesNotMatch(html, /id="tokenInput"/);
  assert.doesNotMatch(html, /saveTokenBtn|testTokenBtn|clearTokenBtn/);
});
```

- [ ] **Step 2: Run tests to verify the contract tests fail**

Run:

```bash
node --test family_todo_login.test.mjs
```

Expected: FAIL because the current app still uses remote JSON CRUD storage and token controls.

- [ ] **Step 3: Commit failing tests**

```bash
git add family_todo_login.test.mjs
git commit -m "test: expect firebase storage contract"
```

---

### Task 2: Firebase-Aware Test Harness

**Files:**
- Modify: `family_todo_login.test.mjs:8-110`
- Test: `family_todo_login.test.mjs`

- [ ] **Step 1: Replace fetch-specific test helpers with Firebase fakes**

Remove `createResponse()` if no remaining test uses it. Keep `createDeferred()` for listener ordering tests.

Add a Firebase fake factory:

```js
function createFirebaseFake(initialData = null) {
  const listeners = [];
  const writes = [];
  const reads = [];
  let data = initialData;

  const docRef = {
    onSnapshot(success, failure) {
      listeners.push({ success, failure });
      return () => {
        const listener = listeners.find(entry => entry.success === success);
        if (listener) listener.unsubscribed = true;
      };
    },
    async set(payload) {
      writes.push(payload);
      data = payload;
    },
    async get() {
      reads.push(true);
      return {
        exists: data !== null,
        data: () => data
      };
    }
  };

  return {
    writes,
    reads,
    listeners,
    emitSnapshot(payload = data, options = {}) {
      data = payload;
      const snapshot = {
        exists: payload !== null,
        data: () => payload,
        metadata: { hasPendingWrites: Boolean(options.hasPendingWrites) }
      };
      for (const listener of listeners) {
        if (!listener.unsubscribed) listener.success(snapshot);
      }
    },
    emitError(error) {
      for (const listener of listeners) {
        if (!listener.unsubscribed && listener.failure) listener.failure(error);
      }
    },
    api: {
      apps: [],
      initializeApp(config, name = "[DEFAULT]") {
        const app = {
          config,
          name,
          delete: async () => {
            this.apps = this.apps.filter(candidate => candidate !== app);
          }
        };
        this.apps.push(app);
        this.config = config;
        return app;
      },
      app(name = "[DEFAULT]") {
        return this.apps.find(app => app.name === name) || this.apps[0];
      },
      firestore(app = this.app()) {
        this.firestoreApp = app;
        return {
          collection(name) {
            assert.equal(name, "familyTodo");
            return {
              doc(id) {
                assert.equal(id, "main");
                return docRef;
              }
            };
          }
        };
      }
    }
  };
}
```

- [ ] **Step 2: Update `createScriptContext` to provide browser globals**

Change the signature to:

```js
function createScriptContext(options = {}) {
  const {
    firebaseFake = createFirebaseFake({ items: [] }),
    locationSearch = "?apiKey=test-key",
    storedValues = [["familyTodoLoginName", "Peggy"]],
    promptResult = "test-key"
  } = options;
  // ...
}
```

Inside the VM context, provide:

```js
let sharedPayload = null;

location: {
  search: locationSearch,
  origin: "https://example.test",
  pathname: "/family_todo_login.html"
},
window: null, // set to context after creation if implementation references window
firebase: firebaseFake.api,
navigator: {
  share: async payload => {
    sharedPayload = payload;
  }
},
get sharedPayload() {
  return sharedPayload;
},
prompt: () => promptResult,
alert: () => {},
```

After creating `context`, set `context.window = context`. The fake `localStorage` must include `getItem`, `setItem`, and `removeItem` because clearing Firebase setup calls `localStorage.removeItem(FIREBASE_API_KEY_KEY)`.

- [ ] **Step 3: Update the behavior test to use Firestore writes**

Replace `ignores stale background loads that finish after adding an item` with a Firestore listener equivalent:

```js
test("ignores stale Firestore snapshots that arrive after adding an item", async () => {
  const firebaseFake = createFirebaseFake({ items: [] });
  const { context, elements } = createScriptContext({ firebaseFake });

  firebaseFake.emitSnapshot({ items: [] });
  await flushPromises();

  elements.get("textInput").value = "milk";
  await context.addItem();

  assert.equal(firebaseFake.writes[0].items[0].text, "milk");
  assert.match(elements.get("costcoList").innerHTML, /milk/);

  firebaseFake.emitSnapshot({ items: [] });
  await flushPromises();

  assert.match(elements.get("costcoList").innerHTML, /milk/);
});
```

Add a listener cleanup test:

```js
test("clearing the Firebase key unsubscribes the active listener", async () => {
  const firebaseFake = createFirebaseFake({ items: [] });
  const { context, elements } = createScriptContext({ firebaseFake });
  await flushPromises();

  firebaseFake.emitSnapshot({ items: [] });
  assert.equal(firebaseFake.listeners.length, 1);

  await context.clearFirebaseKey();

  assert.equal(firebaseFake.listeners[0].unsubscribed, true);
  assert.equal(elements.get("settingsStatus").textContent, "Firebase API key 已清除。");
});
```

Add a no-mutation test for the settings test button:

```js
test("testing Firebase reads once without replacing the visible list", async () => {
  const firebaseFake = createFirebaseFake({
    updatedAt: "2026-06-30T10:05:00.000Z",
    items: [{ id: "2", text: "bread", type: "shopping", store: "Costco", by: "Peggy", done: false, createdAt: "2026-06-30T10:05:00.000Z", doneAt: null }]
  });
  const { context, elements } = createScriptContext({ firebaseFake });
  await flushPromises();

  firebaseFake.emitSnapshot({
    updatedAt: "2026-06-30T10:00:00.000Z",
    items: [{ id: "1", text: "milk", type: "shopping", store: "Costco", by: "Peggy", done: false, createdAt: "2026-06-30T10:00:00.000Z", doneAt: null }]
  });
  await flushPromises();

  assert.match(elements.get("costcoList").innerHTML, /milk/);
  await context.testFirebaseConnection();

  assert.equal(firebaseFake.reads.length, 1);
  assert.equal(firebaseFake.listeners.length, 1);
  assert.match(elements.get("costcoList").innerHTML, /milk/);
  assert.doesNotMatch(elements.get("costcoList").innerHTML, /bread/);
});
```

Add a same-page key-change test:

```js
test("saving a different Firebase key recreates the Firebase app and listener", async () => {
  const firebaseFake = createFirebaseFake({ items: [] });
  const { context, elements } = createScriptContext({ firebaseFake });
  await flushPromises();

  assert.equal(firebaseFake.listeners.length, 1);
  elements.get("firebaseKeyInput").value = "second-key";

  await context.saveFirebaseKey();

  assert.equal(firebaseFake.api.config.apiKey, "second-key");
  assert.equal(firebaseFake.listeners.length, 2);
  assert.equal(firebaseFake.listeners[0].unsubscribed, true);
});
```

- [ ] **Step 4: Run tests to verify harness updates still fail only on implementation**

Run:

```bash
node --test family_todo_login.test.mjs
```

Expected: FAIL because `family_todo_login.html` has not been migrated to Firebase yet. Failures should point to missing Firebase functions/IDs/contract, not syntax errors in the test file.

- [ ] **Step 5: Commit harness changes**

```bash
git add family_todo_login.test.mjs
git commit -m "test: mock firebase storage behavior"
```

---

### Task 3: Firebase SDK And Settings UI

**Files:**
- Modify: `family_todo_login.html:6-8`
- Modify: `family_todo_login.html:471-480`
- Modify: `family_todo_login.html:557-665`
- Test: `family_todo_login.test.mjs`

- [ ] **Step 1: Add Firebase compat SDK scripts before the inline script**

Insert before the app's inline `<script>`:

```html
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
```

- [ ] **Step 2: Replace bearer-token settings markup**

Replace the existing token controls with:

```html
              <h2>Firebase 设置</h2>
              <label for="firebaseKeyInput">Firebase API key</label>
              <input id="firebaseKeyInput" type="password" autocomplete="off" placeholder="输入 Firebase API key" />
              <div class="settings-actions">
                <button id="saveFirebaseKeyBtn">保存 key</button>
                <button class="secondary" id="testFirebaseBtn">测试</button>
                <button class="secondary" id="clearFirebaseKeyBtn">清除</button>
                <button class="secondary" id="shareFirebaseBtn">分享</button>
              </div>
```

Keep the existing `settingsStatus`, `bulkImportInput`, and `importLinesBtn` markup.

- [ ] **Step 3: Replace storage constants and DOM references**

Remove remote JSON constants and add:

```js
    const FIREBASE_API_KEY_KEY = "firebaseApiKey";
    const FIREBASE_COLLECTION = "familyTodo";
    const FIREBASE_DOC_ID = "main";
    const LOGIN_KEY = "familyTodoLoginName";
    const FIREBASE_CONFIG = {
      authDomain: "homeinventory-4718c.firebaseapp.com",
      projectId: "homeinventory-4718c",
      storageBucket: "homeinventory-4718c.firebasestorage.app",
      messagingSenderId: "719884896213",
      appId: "1:719884896213:web:e93d5dffc79dec10995f5c"
    };
```

Replace token DOM references with:

```js
    const firebaseKeyInput = document.getElementById("firebaseKeyInput");
    const saveFirebaseKeyBtn = document.getElementById("saveFirebaseKeyBtn");
    const testFirebaseBtn = document.getElementById("testFirebaseBtn");
    const clearFirebaseKeyBtn = document.getElementById("clearFirebaseKeyBtn");
    const shareFirebaseBtn = document.getElementById("shareFirebaseBtn");
```

Add runtime state:

```js
    let db = null;
    let todoDocRef = null;
    let unsubscribeTodo = null;
    let firebaseConfigured = false;
    let activeFirebaseApiKey = "";
    let isSaving = false;
    let localChangeVersion = 0;
    let lastRemoteUpdatedAt = "";
    let pendingLocalUpdatedAt = "";
```

- [ ] **Step 4: Update initialization and settings handlers**

Replace polling startup with Firebase startup:

```js
      startFirebaseSync();
```

Remove the `setInterval(...)` block.

Update `setupSettings()` so it uses Firebase controls:

```js
      firebaseKeyInput.value = getStoredFirebaseApiKey();
      updateSettingsStatus();
      // menu open should refresh firebaseKeyInput and focus it
      saveFirebaseKeyBtn.addEventListener("click", () => {
        saveFirebaseKey();
      });
      testFirebaseBtn.addEventListener("click", testFirebaseConnection);
      clearFirebaseKeyBtn.addEventListener("click", () => {
        clearFirebaseKey();
      });
      shareFirebaseBtn.addEventListener("click", shareFirebaseLink);
      importLinesBtn.addEventListener("click", importLines);
      firebaseKeyInput.addEventListener("keydown", event => {
        if (event.key === "Enter") saveFirebaseKey();
      });
```

- [ ] **Step 5: Implement API key helpers**

Add:

```js
    function getUrlApiKey() {
      return new URLSearchParams(location.search).get("apiKey") || "";
    }

    function getFirebaseApiKey() {
      const apiKeyFromUrl = getUrlApiKey().trim();
      if (apiKeyFromUrl) {
        localStorage.setItem(FIREBASE_API_KEY_KEY, apiKeyFromUrl);
        return apiKeyFromUrl;
      }

      return localStorage.getItem(FIREBASE_API_KEY_KEY) || "";
    }

    function getStoredFirebaseApiKey() {
      return localStorage.getItem(FIREBASE_API_KEY_KEY) || "";
    }
```

Use `getFirebaseApiKey()` during startup so URL key has priority. Use `getStoredFirebaseApiKey()` when updating the settings field after startup to avoid repeatedly parsing an old URL value after the user clears the key.

- [ ] **Step 6: Implement settings actions**

Add:

```js
    async function saveFirebaseKey() {
      const apiKey = firebaseKeyInput.value.trim();
      if (!apiKey) {
        firebaseKeyInput.focus();
        updateSettingsStatus("请输入 Firebase API key。");
        return;
      }

      localStorage.setItem(FIREBASE_API_KEY_KEY, apiKey);
      updateSettingsStatus("Firebase API key 已保存。");
      setStatus("Firebase API key 已保存，正在同步...");
      await startFirebaseSync(apiKey);
    }

    async function clearFirebaseKey() {
      localStorage.removeItem(FIREBASE_API_KEY_KEY);
      firebaseKeyInput.value = "";
      await stopFirebaseSync();
      updateSettingsStatus("Firebase API key 已清除。");
      setStatus("请在右上角菜单中设置 Firebase API key。");
    }

    async function testFirebaseConnection() {
      try {
        updateSettingsStatus("正在测试...");
        const apiKey = firebaseKeyInput.value.trim() || getStoredFirebaseApiKey();
        if (!apiKey) throw new Error("missing-firebase-api-key");
        await readTodoDocOnce(apiKey);
        updateSettingsStatus("Firebase 可用。");
        setStatus("Firebase 连接可用。");
      } catch (error) {
        console.error(error);
        updateSettingsStatus("测试失败，请检查 Firebase API key。");
        setStatus("Firebase 测试失败。");
      }
    }

    function shareFirebaseLink() {
      const apiKey = getStoredFirebaseApiKey() || firebaseKeyInput.value.trim();
      const baseUrl = location.origin + location.pathname;
      const shareUrl = apiKey
        ? baseUrl + "?apiKey=" + encodeURIComponent(apiKey)
        : baseUrl;

      if (navigator.share) {
        navigator.share({
          title: "家庭待办和购物清单",
          text: "打开家庭待办和购物清单",
          url: shareUrl
        }).catch(error => console.error("分享失败", error));
      } else {
        prompt("复制这个链接：", shareUrl);
      }

      settingsPanel.classList.remove("show");
    }
```

Update `updateSettingsStatus()`:

```js
      settingsStatus.textContent = getStoredFirebaseApiKey()
        ? "已保存 Firebase API key。"
        : "未设置 Firebase API key。";
```

- [ ] **Step 7: Run tests to verify UI/contract progress**

Run:

```bash
node --test family_todo_login.test.mjs
```

Expected: Some Firebase contract/settings tests may pass, but storage behavior tests still fail until Firestore sync is implemented.

- [ ] **Step 8: Commit SDK/settings changes**

```bash
git add family_todo_login.html family_todo_login.test.mjs
git commit -m "feat: add firebase settings"
```

---

### Task 4: Firestore Sync And Save Behavior

**Files:**
- Modify: `family_todo_login.html:687-1021`
- Test: `family_todo_login.test.mjs`

- [ ] **Step 1: Remove remote JSON helpers**

Delete these functions entirely:

- `getStorageToken`
- `getStorageHeaders`
- `fetchStorage`
- `saveStorageToken`
- `clearStorageToken`
- `testStorageToken`
- `loadItems`
- `isCurrentLoad`

- [ ] **Step 2: Add Firebase initialization helpers**

Add:

```js
    async function startFirebaseSync(apiKey = getFirebaseApiKey()) {
      if (!apiKey) {
        firebaseConfigured = false;
        render();
        setStatus("请在右上角菜单中设置 Firebase API key。");
        return;
      }

      try {
        stopTodoListener();
        await ensureFirebaseInitialized(apiKey);
        subscribeToTodoDoc();
      } catch (error) {
        console.error(error);
        firebaseConfigured = false;
        setStatus("Firebase 初始化失败，请检查 API key。");
        render();
      }
    }

    async function ensureFirebaseInitialized(apiKey) {
      if (!apiKey) {
        throw new Error("missing-firebase-api-key");
      }

      if (activeFirebaseApiKey && activeFirebaseApiKey !== apiKey) {
        stopTodoListener();
        if (firebase.apps && firebase.apps.length > 0 && firebase.app().delete) {
          await firebase.app().delete();
        }
      }

      const config = { ...FIREBASE_CONFIG, apiKey };
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(config);
      }

      activeFirebaseApiKey = apiKey;
      db = firebase.firestore();
      todoDocRef = db.collection(FIREBASE_COLLECTION).doc(FIREBASE_DOC_ID);
      firebaseConfigured = true;
    }

    async function readTodoDocOnce(apiKey) {
      if (todoDocRef && activeFirebaseApiKey === apiKey) {
        return getTodoDocRef().get();
      }

      const appName = "familyTodoTest-" + Date.now();
      const testApp = firebase.initializeApp({ ...FIREBASE_CONFIG, apiKey }, appName);
      try {
        return firebase.firestore(testApp)
          .collection(FIREBASE_COLLECTION)
          .doc(FIREBASE_DOC_ID)
          .get();
      } finally {
        if (testApp.delete) {
          await testApp.delete();
        }
      }
    }

    function stopTodoListener() {
      if (unsubscribeTodo) {
        unsubscribeTodo();
        unsubscribeTodo = null;
      }
    }

    async function stopFirebaseSync() {
      stopTodoListener();
      if (firebase.apps && firebase.apps.length > 0 && firebase.app().delete) {
        await firebase.app().delete();
      }
      db = null;
      todoDocRef = null;
      firebaseConfigured = false;
      activeFirebaseApiKey = "";
    }

    function getTodoDocRef() {
      if (!todoDocRef) {
        throw new Error("firebase-not-configured");
      }
      return todoDocRef;
    }
```

If the compat fake does not provide `firebase.apps`, add it to the fake rather than weakening the production code. The implementation should recreate the default Firebase app when `activeFirebaseApiKey !== apiKey` so saving a corrected key works without a refresh. The settings test button must use `readTodoDocOnce(apiKey)` and must not call `subscribeToTodoDoc()`.

```js
        if (!firebase.apps || firebase.apps.length === 0) {
          firebase.initializeApp(config);
        }
```

- [ ] **Step 3: Add Firestore subscription and payload parsing**

Add:

```js
    function subscribeToTodoDoc() {
      const changeVersionAtSubscribe = localChangeVersion;
      unsubscribeTodo = getTodoDocRef().onSnapshot(snapshot => {
        if (snapshot.metadata && snapshot.metadata.hasPendingWrites) {
          return;
        }

        if (!snapshot.exists) {
          if (localChangeVersion !== changeVersionAtSubscribe) return;
          items = [];
          render();
          setStatus("Firebase 文档不存在，添加事项后会自动创建。");
          return;
        }

        const data = snapshot.data() || {};
        if (!Array.isArray(data.items)) {
          if (localChangeVersion !== changeVersionAtSubscribe) return;
          items = [];
          render();
          setStatus("Firebase 数据为空。");
          return;
        }

        const remoteUpdatedAt = data.updatedAt || "";
        if (!remoteUpdatedAt && localChangeVersion !== changeVersionAtSubscribe) {
          return;
        }

        if (lastRemoteUpdatedAt && remoteUpdatedAt && remoteUpdatedAt < lastRemoteUpdatedAt) {
          return;
        }

        if (pendingLocalUpdatedAt && remoteUpdatedAt && remoteUpdatedAt < pendingLocalUpdatedAt) {
          return;
        }

        items = data.items;
        if (remoteUpdatedAt) {
          lastRemoteUpdatedAt = remoteUpdatedAt;
        }
        if (remoteUpdatedAt === pendingLocalUpdatedAt) {
          pendingLocalUpdatedAt = "";
        }
        render();
        setStatus("已同步：" + new Date().toLocaleTimeString());
      }, error => {
        console.error(error);
        setStatus("Firebase 同步失败，请检查 API key 和 Firestore 设置。");
        render();
      });
    }
```

This guard accepts newer Firestore documents, ignores older documents, and ignores documents without `updatedAt` once local edits exist. Keep the final code covered by the stale snapshot test.

- [ ] **Step 4: Replace `saveItems()` with Firestore write**

Use:

```js
    async function saveItems() {
      isSaving = true;

      try {
        if (!firebaseConfigured || !todoDocRef) {
          setStatus("保存失败：请先在右上角菜单中设置 Firebase API key。");
          return;
        }

        setStatus("正在保存...");

        const payload = {
          app: "family-todo",
          version: 2,
          updatedAt: new Date().toISOString(),
          items
        };

        pendingLocalUpdatedAt = payload.updatedAt;
        await getTodoDocRef().set(payload);
        lastRemoteUpdatedAt = payload.updatedAt;
        setStatus("已保存：" + new Date().toLocaleTimeString());
      } catch (error) {
        console.error(error);
        setStatus("保存失败。请检查 Firebase API key 和 Firestore 设置。");
      } finally {
        isSaving = false;
      }
    }
```

- [ ] **Step 5: Preserve item interaction functions**

Confirm these functions still call `markLocalChange()`, `render()`, and `await saveItems()`:

- `addItem`
- `toggleDone`
- `deleteItem`
- `clearAllItems`
- `importLines`

Do not change their item object shape except for storage version moving to `2` in the Firestore document payload.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test family_todo_login.test.mjs
```

Expected: all Node tests pass. If the stale snapshot test fails, tighten the local-write guard before continuing.

- [ ] **Step 7: Commit Firestore sync**

```bash
git add family_todo_login.html family_todo_login.test.mjs
git commit -m "feat: store todos in firestore"
```

---

### Task 5: Verification And Manual QA

**Files:**
- Test: `family_todo_login.test.mjs`
- Manual target: `family_todo_login.html`

- [ ] **Step 1: Run automated tests**

Run:

```bash
node --test family_todo_login.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Scan for removed remote storage code**

Run:

```bash
rg -n "home\\.gochatus|/files|/usage|Bearer|DEFAULT_STORAGE_TOKEN|fetchStorage|familyTodoStorageToken|tokenInput|saveTokenBtn|testTokenBtn|clearTokenBtn" family_todo_login.html family_todo_login.test.mjs
```

Expected: no matches.

- [ ] **Step 3: Scan for Firebase contract code**

Run:

```bash
rg -n "firebaseApiKey|firebase-app-compat|firebase-firestore-compat|homeinventory-4718c|familyTodo|onSnapshot|saveFirebaseKey|clearFirebaseKey|shareFirebaseLink" family_todo_login.html family_todo_login.test.mjs
```

Expected: matches in both HTML and tests.

- [ ] **Step 4: Run a syntax smoke check**

Run:

```bash
node --check family_todo_login.test.mjs
```

Expected: no syntax errors.

There is no direct `node --check` for the inline browser script after extraction in the current repo. The VM tests execute the inline script and serve as the syntax smoke test for `family_todo_login.html`.

- [ ] **Step 5: Manual browser verification**

Open `family_todo_login.html` in a browser and verify:

- Page renders without a JavaScript error when no Firebase key is configured.
- Settings menu shows Firebase API key controls and import controls.
- Saving a key starts sync without refreshing.
- Test button reports Firebase connection status.
- Share button produces a URL containing `?apiKey=`.
- Saving a bad key, then saving a corrected key in the same page session, recreates sync without requiring refresh.
- Add, complete, delete, import, and clear-all work.
- Opening the app in a second window with the same API key receives realtime updates.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional changes remain. Existing unrelated untracked files from before this work may still be present; do not remove or revert them.
