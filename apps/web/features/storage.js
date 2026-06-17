const DB_NAME = "MortgageStrategyDB";
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/**
 * Opens and initializes the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }
  
  if (dbPromise) {
    return dbPromise;
  }
  
  dbPromise = new Promise((resolve, reject) => {
    console.log("[IndexedDB] Opening database:", DB_NAME, "version:", DB_VERSION);
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      console.error("[IndexedDB] Error opening database:", request.error);
      dbPromise = null; // reset to allow retry
      reject(request.error);
    };
    
    request.onsuccess = () => {
      console.log("[IndexedDB] Database opened successfully");
      resolve(request.result);
    };
    
    request.onblocked = () => {
      console.warn("[IndexedDB] Database open blocked by another connection");
      dbPromise = null;
      reject(new Error("IndexedDB open blocked"));
    };
    
    request.onupgradeneeded = () => {
      console.log("[IndexedDB] Database upgrade needed");
      const db = request.result;
      if (!db.objectStoreNames.contains("mortgages")) {
        db.createObjectStore("mortgages", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("scenarios")) {
        db.createObjectStore("scenarios", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("constraints")) {
        db.createObjectStore("constraints", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("savedResults")) {
        db.createObjectStore("savedResults", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("marketCache")) {
        db.createObjectStore("marketCache", { keyPath: "id" });
      }
    };
  });
  
  return dbPromise;
}

/**
 * Gets an item by key from the database.
 * @param {string} storeName - Store name
 * @param {string} id - Item ID
 * @returns {Promise<any>}
 */
export async function dbGet(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Puts an item into the database.
 * @param {string} storeName - Store name
 * @param {any} data - Object containing the keyPath field
 * @returns {Promise<any>}
 */
export async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(data);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Retrieves all items in a store.
 * @param {string} storeName - Store name
 * @returns {Promise<any[]>}
 */
export async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Deletes an item by key from the database.
 * @param {string} storeName - Store name
 * @param {string} id - Item ID
 * @returns {Promise<any>}
 */
export async function dbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
