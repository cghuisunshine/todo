import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("./family_todo_login.html", import.meta.url), "utf8");

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

function createTestElement(id) {
  const listeners = new Map();
  const classes = new Set();

  return {
    id,
    value: id === "typeInput" ? "shopping" : id === "storeInput" ? "Costco" : "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    addEventListener(type, handler) {
      listeners.set(type, handler);
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

function createScriptContext(fetch) {
  const elements = new Map();
  const storage = new Map([["familyTodoLoginName", "Peggy"]]);

  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createTestElement(id));
      }

      return elements.get(id);
    },
    addEventListener() {}
  };

  const context = {
    AbortController,
    console,
    confirm: () => true,
    document,
    fetch,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      }
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
    clearTimeout
  };

  vm.createContext(context);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, context);

  return { context, elements };
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
  assert.match(html, /aria-label="全部清除"/);
  assert.match(html, /clearAllBtn\.addEventListener\("click", clearAllItems\)/);
  assert.match(html, /async function clearAllItems/);
  assert.match(html, /confirm\("确定清除全部事项吗？"\)/);
  assert.match(html, /items = \[\];/);
});

test("ignores stale background loads that finish after adding an item", async () => {
  let getCount = 0;
  let savedPayload;
  const staleLoad = createDeferred();

  const { context, elements } = createScriptContext(async (url, options = {}) => {
    const method = options.method || "GET";

    if (url.includes("/files?path=") && method === "GET") {
      getCount += 1;

      if (getCount === 1) {
        return createResponse({ content: { items: [] } });
      }

      return staleLoad.promise;
    }

    if (url.endsWith("/files") && method === "PUT") {
      savedPayload = JSON.parse(options.body);
      return createResponse({});
    }

    throw new Error("Unexpected fetch: " + method + " " + url);
  });

  await flushPromises();

  const staleLoadPromise = context.loadItems(false);
  elements.get("textInput").value = "milk";

  await context.addItem();

  assert.equal(savedPayload.content.items[0].text, "milk");
  assert.match(elements.get("costcoList").innerHTML, /milk/);

  staleLoad.resolve(createResponse({ content: { items: [] } }));
  await staleLoadPromise;

  assert.match(elements.get("costcoList").innerHTML, /milk/);
});
