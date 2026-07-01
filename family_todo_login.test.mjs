import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("./family_todo_login.html", import.meta.url), "utf8");

function createTestElement(id) {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();

  return {
    id,
    value: id === "typeInput" ? "shopping" : id === "storeInput" ? "Costco" : "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    trigger(type, event = {}) {
      if (listeners.has(type)) {
        return listeners.get(type)(event);
      }
    },
    focus() {},
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name) {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }

        classes.add(name);
        return true;
      },
      contains(name) {
        return classes.has(name);
      }
    }
  };
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
}

function createFirebaseFake(initialData = null) {
  const listeners = [];
  const writes = [];
  const reads = [];
  let data = initialData;
  let readData = initialData;

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
      readData = payload;
    },
    async get() {
      reads.push(true);
      const payload = readData;
      return {
        exists: payload !== null,
        data: () => payload
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

function createScriptContext(options = {}) {
  const {
    firebaseFake = createFirebaseFake({ items: [] }),
    locationSearch = "?apiKey=test-key",
    storedValues = [["familyTodoLoginName", "Peggy"]],
    promptResult = "test-key"
  } = options;
  const elements = new Map();
  const storage = new Map(storedValues);

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createTestElement(id));
      }

      return elements.get(id);
    },
    addEventListener() {}
  };
  let sharedPayload = null;

  const context = {
    AbortController,
    console,
    confirm: () => true,
    document,
    firebase: firebaseFake.api,
    location: {
      search: locationSearch,
      origin: "https://example.test",
      pathname: "/family_todo_login.html"
    },
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    navigator: {
      async share(payload) {
        sharedPayload = payload;
      }
    },
    prompt: () => promptResult,
    alert: () => {},
    URLSearchParams,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    get sharedPayload() {
      return sharedPayload;
    }
  };
  context.window = context;

  vm.createContext(context);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);

  return { context, elements, storage };
}

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
  assert.doesNotMatch(html, /AIzaSyCQCgHO0XAXQplM3gTOWIdK1OgtUYT9coI/);
  assert.doesNotMatch(html, /FIREBASE_API_KEY_DEFAULT/);
});

test("always shows completed items without a toggle button", () => {
  assert.doesNotMatch(html, /id="showDoneBtn"/);
  assert.doesNotMatch(html, /let showDone/);
  assert.match(html, /const visibleItems = sortVisibleItems\(items\);/);
  assert.doesNotMatch(html, /items\.filter\(item => !item\.done\)/);
});

test("does not show add or refresh buttons", () => {
  assert.doesNotMatch(html, /id="addBtn"/);
  assert.doesNotMatch(html, /id="reloadBtn"/);
  assert.doesNotMatch(html, /getElementById\("addBtn"\)/);
  assert.doesNotMatch(html, /getElementById\("reloadBtn"\)/);
  assert.doesNotMatch(html, />添加<\/button>/);
  assert.doesNotMatch(html, />刷新<\/button>/);
});

test("pins the add section to the bottom viewport after the lists", () => {
  const costcoIndex = html.indexOf("<h2>Costco 购物</h2>");
  const otherShoppingIndex = html.indexOf("<h2>其他购物</h2>");
  const todoIndex = html.indexOf("<h2>家庭待办</h2>");
  const addIndex = html.indexOf("class=\"entry-title\">添加新事项</h2>");

  assert.ok(costcoIndex > -1);
  assert.ok(otherShoppingIndex > costcoIndex);
  assert.ok(todoIndex > otherShoppingIndex);
  assert.ok(addIndex > todoIndex);
  assert.match(html, /class="card entry-card"/);
  assert.match(html, /id="entryCard"/);
  assert.match(html, /class="entry-header"/);
  assert.match(html, /class="entry-title"/);
  assert.match(html, /id="entryBody"/);
});

test("remembers whether the add card was collapsed and restores the floating toggle state", () => {
  const { elements, storage } = createScriptContext({
    storedValues: [
      ["familyTodoLoginName", "Peggy"],
      ["familyTodoEntryCollapsed", "1"]
    ]
  });

  assert.equal(elements.get("entryCard").classList.contains("collapsed"), true);
  assert.equal(elements.get("entryBody").classList.contains("collapsed"), true);
  assert.equal(elements.get("entryToggleBtn").classList.contains("floating"), true);
  assert.equal(elements.get("entryToggleBtn").textContent, "+");
  assert.equal(elements.get("entryToggleBtn").getAttribute("aria-label"), "展开添加事项");

  elements.get("entryToggleBtn").trigger("click");

  assert.equal(elements.get("entryCard").classList.contains("collapsed"), false);
  assert.equal(elements.get("entryBody").classList.contains("collapsed"), false);
  assert.equal(elements.get("entryToggleBtn").classList.contains("floating"), false);
  assert.equal(elements.get("entryToggleBtn").textContent, "-");
  assert.equal(storage.get("familyTodoEntryCollapsed"), "0");
});

test("changes user by double-clicking the current user display", () => {
  assert.doesNotMatch(html, /id="changeUserBtn"/);
  assert.doesNotMatch(html, /getElementById\("changeUserBtn"\)/);
  assert.doesNotMatch(html, />更换用户<\/button>/);

  const { elements } = createScriptContext();
  assert.equal(elements.get("loginOverlay").classList.contains("show"), false);

  elements.get("currentUserText").trigger("dblclick");

  assert.equal(elements.get("loginNameInput").value, "Peggy");
  assert.equal(elements.get("loginOverlay").classList.contains("show"), true);
});

test("keeps type store and added-by controls in the input-side dropdown", () => {
  assert.match(html, /id="metadataBtn"/);
  assert.match(html, /id="metadataPanel"/);
  assert.match(html, /class="metadata-panel"/);
  assert.match(html, /id="typeInput"/);
  assert.match(html, /id="storeInput"/);
  assert.match(html, /id="byInput"/);
  assert.match(html, /value="shopping" selected/);
  assert.match(html, /value="Costco" selected/);
  assert.match(html, /metadataPanel\.classList\.toggle\("show"\)/);
  assert.match(html, /const type = typeInput\.value;/);
  assert.match(html, /const store = type === "shopping" \? storeInput\.value : "";/);
  assert.match(html, /const by = byInput\.value \|\| loginName;/);
});

test("shows an inline plus at the end of the input when text is ready to add", async () => {
  const firebaseFake = createFirebaseFake({ items: [] });
  const { elements } = createScriptContext({ firebaseFake });

  const textInput = elements.get("textInput");
  const addInputBtn = elements.get("addInputBtn");

  assert.equal(addInputBtn.classList.contains("show"), false);

  textInput.value = "   ";
  textInput.trigger("input");
  assert.equal(addInputBtn.classList.contains("show"), false);

  textInput.value = "milk";
  textInput.trigger("input");
  assert.equal(addInputBtn.classList.contains("show"), true);

  await addInputBtn.trigger("click");

  assert.equal(firebaseFake.writes[0].items[0].text, "milk");
  assert.equal(textInput.value, "");
  assert.equal(addInputBtn.classList.contains("show"), false);
});

test("shows the last added item in the status field", async () => {
  const firebaseFake = createFirebaseFake({ items: [] });
  const { elements } = createScriptContext({ firebaseFake });

  const textInput = elements.get("textInput");
  textInput.value = "milk";
  await elements.get("addInputBtn").trigger("click");

  assert.equal(textInput.value, "");
  assert.equal(elements.get("status").textContent, "milk added");
  assert.match(html, /placeholder="例如：鸡蛋、牛奶、交电费"/);
});

test("renders unfinished items before completed items", () => {
  assert.match(html, /function sortVisibleItems/);
  assert.match(html, /Number\(a\.done\) - Number\(b\.done\)/);
  assert.match(html, /const visibleItems = sortVisibleItems\(items\);/);
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

test("imports copied multiline text from hamburger settings", () => {
  assert.match(html, /id="bulkImportInput"/);
  assert.match(html, /id="importLinesBtn"/);
  assert.match(html, /importLinesBtn\.addEventListener\("click", importLines\)/);
  assert.match(html, /function parseImportedItems/);
  assert.match(html, /split\(\/\\r\?\\n\/\)/);
  assert.match(html, /split\(\/\[,\\uFF0C\]\/\)/);
  assert.match(html, /normalizeImportType/);
  assert.match(html, /rawStore \|\| "Costco"/);
  assert.match(html, /rawBy \|\| loginName/);
});

test("includes a clear-all icon button with confirmation", () => {
  assert.match(html, /id="clearAllBtn"/);
  assert.match(html, /class="icon-btn clear-all-btn"/);
  assert.match(html, /aria-label="全部清除"/);
  assert.match(html, /<span class="clear-all-badge" aria-hidden="true">ALL<\/span>/);
  assert.match(html, /clearAllBtn\.addEventListener\("click", clearAllItems\)/);
  assert.match(html, /async function clearAllItems/);
  assert.match(html, /confirm\("确定清除全部事项吗？"\)/);
  assert.match(html, /items = \[\];/);
});

test("includes clear-all icon buttons for each list section", async () => {
  assert.match(html, /class="section-clear clear-all-btn" id="clearCostcoBtn"/);
  assert.match(html, /aria-label="清除 Costco 购物"/);
  assert.match(html, /class="section-clear clear-all-btn" id="clearOtherShoppingBtn"/);
  assert.match(html, /aria-label="清除其他购物"/);
  assert.match(html, /class="section-clear clear-all-btn" id="clearTodoBtn"/);
  assert.match(html, /aria-label="清除家庭待办"/);
  assert.equal((html.match(/<span class="clear-all-badge" aria-hidden="true">ALL<\/span>/g) || []).length, 4);
  assert.match(html, /clearCostcoBtn\.addEventListener\("click", \(\) => clearItemsBySection\("costco"\)\)/);
  assert.match(html, /clearOtherShoppingBtn\.addEventListener\("click", \(\) => clearItemsBySection\("otherShopping"\)\)/);
  assert.match(html, /clearTodoBtn\.addEventListener\("click", \(\) => clearItemsBySection\("todo"\)\)/);
  assert.match(html, /async function clearItemsBySection\(section\)/);

  const firebaseFake = createFirebaseFake({ items: [] });
  const { elements } = createScriptContext({ firebaseFake });

  elements.get("textInput").value = "milk";
  elements.get("typeInput").value = "shopping";
  elements.get("storeInput").value = "Costco";
  await elements.get("textInput").trigger("keydown", { key: "Enter" });

  elements.get("textInput").value = "bananas";
  elements.get("typeInput").value = "shopping";
  elements.get("storeInput").value = "T&T";
  await elements.get("textInput").trigger("keydown", { key: "Enter" });

  elements.get("textInput").value = "wash towels";
  elements.get("typeInput").value = "todo";
  await elements.get("textInput").trigger("keydown", { key: "Enter" });

  await elements.get("clearOtherShoppingBtn").trigger("click");

  const latestWrite = firebaseFake.writes.at(-1);
  assert.deepEqual(Array.from(latestWrite.items, item => item.text), ["wash towels", "milk"]);
  assert.match(elements.get("costcoList").innerHTML, /milk/);
  assert.doesNotMatch(elements.get("otherShoppingList").innerHTML, /bananas/);
  assert.match(elements.get("todoList").innerHTML, /wash towels/);
});

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

test("testing Firebase reads once without replacing the visible list", async () => {
  const firebaseFake = createFirebaseFake({
    updatedAt: "2026-06-30T10:05:00.000Z",
    items: [{
      id: "2",
      text: "bread",
      type: "shopping",
      store: "Costco",
      by: "Peggy",
      done: false,
      createdAt: "2026-06-30T10:05:00.000Z",
      doneAt: null
    }]
  });
  const { context, elements } = createScriptContext({ firebaseFake });
  await flushPromises();

  firebaseFake.emitSnapshot({
    updatedAt: "2026-06-30T10:00:00.000Z",
    items: [{
      id: "1",
      text: "milk",
      type: "shopping",
      store: "Costco",
      by: "Peggy",
      done: false,
      createdAt: "2026-06-30T10:00:00.000Z",
      doneAt: null
    }]
  });
  await flushPromises();

  assert.match(elements.get("costcoList").innerHTML, /milk/);
  await context.testFirebaseConnection();

  assert.equal(firebaseFake.reads.length, 1);
  assert.equal(firebaseFake.listeners.length, 1);
  assert.match(elements.get("costcoList").innerHTML, /milk/);
  assert.doesNotMatch(elements.get("costcoList").innerHTML, /bread/);
});

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
