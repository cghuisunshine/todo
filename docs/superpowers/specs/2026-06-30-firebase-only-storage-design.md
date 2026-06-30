# Firebase-Only Storage Design

## Goal

Replace the existing remote JSON CRUD storage in `family_todo_login.html` with Firebase Firestore as the only shared storage backend, using `https://cghuisunshine.github.io/chat/` as the Firebase setup reference.

## Scope

This change is limited to storage, synchronization, and the related settings controls. The family todo app remains a standalone HTML file with the existing login, item entry, grouping, import, completion, deletion, and clear-all behavior.

Out of scope:

- Firebase Authentication.
- Per-user permissions.
- A broader UI redesign.
- Migrating existing remote JSON data automatically from `home.gochatus.org`.

## Reference Behavior

The reference chat page loads Firebase compat SDKs, accepts a Firebase API key from the `apiKey` URL parameter or `localStorage`, initializes the fixed `homeinventory-4718c` Firebase project, writes to Firestore, and uses `onSnapshot` for realtime updates.

The todo app should follow that pattern:

- Load `firebase-app-compat.js` and `firebase-firestore-compat.js`.
- Read `apiKey` from the URL first, then from `localStorage` key `firebaseApiKey`.
- Save a URL-provided key back to `localStorage`.
- Initialize Firebase with the same project config from the reference page.
- Use Firestore as the live source of shared data when configured.

Firebase project config:

```js
{
  authDomain: "homeinventory-4718c.firebaseapp.com",
  projectId: "homeinventory-4718c",
  storageBucket: "homeinventory-4718c.firebasestorage.app",
  messagingSenderId: "719884896213",
  appId: "1:719884896213:web:e93d5dffc79dec10995f5c"
}
```

The runtime supplies only the `apiKey` value from URL or `localStorage`.

## Architecture

The app keeps its single-file structure. Remote JSON CRUD constants and helper functions are removed:

- `STORAGE_BASE_URLS`
- `STORAGE_REQUEST_TIMEOUT_MS`
- `STORAGE_PATH`
- `STORAGE_READ_PATH`
- `TOKEN_KEY`
- `DEFAULT_STORAGE_TOKEN`
- `getStorageToken`
- `getStorageHeaders`
- `fetchStorage`
- `/files` and `/usage` requests
- 15-second polling

Firebase is the only remote backend. If Firebase is not configured, the app still renders and keeps the current in-memory list for that session, but it should show a clear status asking the user to configure Firebase. It must not fall back to the previous remote JSON service.

## Firestore Data Model

Use one document so the current full-list save model remains intact:

- Collection: `familyTodo`
- Document: `main`

Document payload:

```json
{
  "app": "family-todo",
  "version": 2,
  "updatedAt": "2026-06-30T00:00:00.000Z",
  "items": []
}
```

Each item keeps the current shape:

```json
{
  "id": "string",
  "text": "string",
  "type": "shopping|todo",
  "store": "string",
  "by": "string",
  "done": false,
  "createdAt": "ISO timestamp",
  "doneAt": "ISO timestamp or null"
}
```

## Data Flow

Startup:

1. Set up login, settings, and entry controls.
2. Resolve the Firebase API key from `?apiKey=` first, then `localStorage`.
3. If a key exists, initialize Firebase and create a Firestore client.
4. Subscribe to `db.collection("familyTodo").doc("main").onSnapshot(...)`.
5. On the first missing document, render an empty list and show that the Firebase document will be created after the next save.
6. If no key exists, render the current empty/session list and show a Firebase setup message.

Realtime updates:

- Firestore snapshot data replaces `items` when it contains an `items` array.
- Stale remote updates must not overwrite a newer unsaved local edit. Keep the existing local change version guard or an equivalent `pendingWrite`/version guard.
- Local actions render immediately before the remote write finishes.

Writes:

- Add, toggle, delete, import, and clear-all update `items`, mark a local change, render, then call `saveItems()`.
- `saveItems()` writes the full document with `.set(payload)`.
- A successful write updates the status with the current time.
- A failed write leaves the visible local changes in place and shows a Firebase save error.

## Settings UI

The hamburger settings panel changes from bearer-token management to Firebase API key management.

Controls:

- Password-style Firebase API key input.
- Save key button.
- Test Firebase button.
- Clear key button.
- Share button that includes `?apiKey=<encoded key>` when a key is available, matching the reference page.
- Existing multiline import controls remain in the same settings panel.

Behavior:

- Saving a key stores it in `localStorage`, initializes Firebase immediately, and starts the Firestore listener without requiring a page refresh.
- Testing verifies that Firestore can read or write the `familyTodo/main` document without changing todo items.
- Clearing removes the saved key, unsubscribes any active Firestore listener, disables Firebase sync for the current page state, and shows a setup message.

## Error Handling

No Firebase API key:

- Show `请在右上角菜单中设置 Firebase API key。`
- Do not attempt remote reads or writes.

Firebase initialization failure:

- Show a Firebase setup/configuration error.
- Keep the app usable locally for the current session.

Firestore read/listener failure:

- Show a read/sync failure status.
- Keep the currently visible list.

Firestore save failure:

- Show a save failure status.
- Keep the local visible change so the user can fix Firebase setup and retry.

## Testing

Update `family_todo_login.test.mjs` to verify the new storage contract:

- Firebase compat SDK scripts are present.
- Firebase project config from the reference page is present.
- API key resolution uses `apiKey` URL parameter before `localStorage`.
- The settings UI uses Firebase API key controls and no bearer token controls.
- The old remote JSON CRUD service is not used: no `home.gochatus.org`, `/files`, `/usage`, `Authorization: Bearer`, or `DEFAULT_STORAGE_TOKEN`.
- Writes call Firestore `.collection("familyTodo").doc("main").set(...)`.
- Reads subscribe with `onSnapshot`.
- Existing todo behavior remains covered: item creation, stale update protection, completed item rendering, metadata dropdown, import, clear-all, and sort order.

Manual verification:

- Open `family_todo_login.html` locally.
- Enter a Firebase API key in settings.
- Add, complete, delete, import, and clear items.
- Open the app in a second browser window with the same API key and verify realtime sync.
