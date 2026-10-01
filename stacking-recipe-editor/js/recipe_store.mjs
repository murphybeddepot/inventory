// Recipes outgrow localStorage's small, origin-wide quota. Keep exact snapshots
// in IndexedDB, one record per SKU. A save succeeds only after transaction commit.
import { compress, decompress } from './packstore.mjs?v=4.49';

export const LEGACY_LIBRARY = 'mbd_stacking_library_v1';
const DB_NAME = 'mbd-stacking-recipes';
const TABLE = 'records';
const PREFIX = 'recipe:';
const encode = value => compress(JSON.stringify(value));
const decode = value => JSON.parse(decompress(value));
function libraryObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Recipe library is unreadable; the original has been preserved.');
  for (const recipe of Object.values(value)) {
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw Error('Invalid recipe in library; the original has been preserved.');
  }
  return value;
}

export function indexedBackend(factory = globalThis.indexedDB) {
  let opening;
  const open = () => opening ||= new Promise((resolve, reject) => {
    if (!factory) { reject(Error('Browser database is unavailable. Keep this page open and download a backup.')); return; }
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Close older recipe-library tabs, then retry.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
  return {
    async read() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(TABLE, 'readonly'), store = tx.objectStore(TABLE);
        const keys = store.getAllKeys(), values = store.getAll();
        tx.oncomplete = () => resolve(Object.fromEntries(keys.result.map((k, i) => [k, values.result[i]])));
        tx.onabort = tx.onerror = () => reject(tx.error || Error('Could not read recipe database.'));
      });
    },
    async change(changes) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(TABLE, 'readwrite'), store = tx.objectStore(TABLE);
        let failure;
        for (const {key, before, after} of changes) {
          const get = store.get(key);
          get.onsuccess = () => {
            if (get.result !== before) {
              failure = Error('This recipe changed in another tab. Your edits are still on screen; download a backup before loading the newer copy.');
              tx.abort(); return;
            }
            if (after === undefined) store.delete(key); else store.put(after, key);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('Recipe save did not commit.'));
      });
    }
  };
}

export function createRecipeLibrary(backend, legacy) {
  let records = {}, ready, initialized = false, tail = Promise.resolve();
  const baselines = new WeakMap();
  const imported = [];
  const api = {
    init() {
      return ready ||= (async () => {
        records = await backend.read();
        // Decode all stored recipes before touching any legacy data.
        for (const [key, value] of Object.entries(records)) if (key.startsWith(PREFIX)) libraryObject({[key]:decode(value)});
        const raw = legacy.getItem(LEGACY_LIBRARY);
        if (raw !== null) {
          const old = libraryObject(decode(raw)), changes = [];
          for (const [sku, recipe] of Object.entries(old)) {
            const key = PREFIX + sku, before = records[key];
            // An older tab can save again after migration. Import a genuinely
            // newer save, while keeping the previous library verbatim as backup.
            if (before === undefined || Date.parse(recipe.savedAt) > Date.parse(decode(before).savedAt)) {
              const restored = before === undefined ? recipe : {...recipe, _revision:recipe._revision ?? decode(before)._revision};
              changes.push({key, before, after:encode(restored)});
              imported.push(restored);
            }
          }
          const backupKey = 'migration:' + Date.now() + ':' + Math.random().toString(36).slice(2);
          changes.push({key:backupKey, before:undefined, after:raw});
          await backend.change(changes);
          records = await backend.read();
          for (const {key, after} of changes) if (records[key] !== after) throw Error('Library migration verification failed; original storage was retained.');
          // Reclaim only this verified copy, never other app data or new edits.
          if (legacy.getItem(LEGACY_LIBRARY) === raw) legacy.removeItem(LEGACY_LIBRARY);
        }
        initialized = true;
      })();
    },
    recoveryAfter(since) {
      if (!(since > 0)) return null;
      return imported.filter(r => Date.parse(r.savedAt) >= since).sort((a,b) => Date.parse(b.savedAt)-Date.parse(a.savedAt))[0] || null;
    },
    read() {
      if (!initialized) throw Error('Recipe library is unavailable or still loading; existing data has been preserved.');
      const lib = Object.fromEntries(Object.entries(records).filter(([k]) => k.startsWith(PREFIX)).map(([k,v]) => [k.slice(PREFIX.length), decode(v)]));
      baselines.set(lib, {...records});
      return lib;
    },
    async refresh() { await api.init(); records = await backend.read(); return api.read(); },
    async save(lib) {
      libraryObject(lib);
      const base = baselines.get(lib);
      if (!base) throw Error('Load the library before saving changes.');
      const next = Object.fromEntries(Object.entries(lib).map(([k,v]) => [PREFIX+k, encode(v)]));
      const changes = [...new Set([...Object.keys(base).filter(k=>k.startsWith(PREFIX)), ...Object.keys(next)])]
        .filter(key => base[key] !== next[key]).map(key => ({key, before:base[key], after:next[key]}));
      const operation = tail.then(async () => {
        await api.init();
        await backend.change(changes);
        records = await backend.read();
        baselines.set(lib, {...next});
      });
      tail = operation.catch(() => {}); // caller receives failure; next attempt may retry
      return operation;
    }
  };
  return api;
}

let instance;
export function recipeLibrary() {
  return instance ||= createRecipeLibrary(indexedBackend(), globalThis.localStorage);
}
