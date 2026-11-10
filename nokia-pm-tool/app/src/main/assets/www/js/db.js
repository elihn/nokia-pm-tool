// Database helper using IndexedDB for offline persistence
const DB_NAME = 'NokiaPM_Database';
const DB_VERSION = 1;

class PMDatabase {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = (e) => reject('IndexedDB error: ' + e.target.error);
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('reports')) {
          db.createObjectStore('reports', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('app_state')) {
          db.createObjectStore('app_state', { keyPath: 'key' });
        }
      };
    });
  }

  async saveTemplate(id, name, structure, fileBuffer) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['templates'], 'readwrite');
      const store = tx.objectStore('templates');
      const item = {
        id,
        name,
        structure,
        fileBuffer,
        updatedAt: new Date().toISOString()
      };
      const req = store.put(item);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getTemplate(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['templates'], 'readonly');
      const store = tx.objectStore('templates');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async listTemplates() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['templates'], 'readonly');
      const store = tx.objectStore('templates');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveReport(report) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['reports'], 'readwrite');
      const store = tx.objectStore('reports');
      report.updatedAt = new Date().toISOString();
      const req = store.put(report);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getReport(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['reports'], 'readonly');
      const store = tx.objectStore('reports');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async listReports() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['reports'], 'readonly');
      const store = tx.objectStore('reports');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteReport(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['reports'], 'readwrite');
      const store = tx.objectStore('reports');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveState(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['app_state'], 'readwrite');
      const store = tx.objectStore('app_state');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getState(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['app_state'], 'readonly');
      const store = tx.objectStore('app_state');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteState(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['app_state'], 'readwrite');
      const store = tx.objectStore('app_state');
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

window.pmDB = new PMDatabase();
