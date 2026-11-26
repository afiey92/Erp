import fs from 'node:fs';
import path from 'node:path';

const SEED = {
  products: [
    { id: 1, sku: 'MEG-1001', name: 'Industrial Bearing 6204', unitPrice: 12.5, stock: 240 },
    { id: 2, sku: 'MEG-1002', name: 'Hydraulic Hose 1m', unitPrice: 34, stock: 85 },
    { id: 3, sku: 'MEG-1003', name: 'Steel Bracket Set', unitPrice: 8.75, stock: 18 },
  ],
  customers: [
    { id: 1, name: 'Northwind Traders', email: 'ops@northwind.example' },
    { id: 2, name: 'Acme Fabrication', email: 'buying@acme.example' },
  ],
  orders: [],
};

export const LOW_STOCK_THRESHOLD = 20;

function isValid(data) {
  return (
    data &&
    Array.isArray(data.products) &&
    Array.isArray(data.customers) &&
    Array.isArray(data.orders)
  );
}

export class Store {
  constructor(file = null) {
    this.file = file;
    this.data = this.#load();
  }

  #load() {
    if (this.file && fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (isValid(parsed)) return parsed;
      } catch {
        // Corrupt file: fall back to the seed so the app still starts.
      }
    }
    return structuredClone(SEED);
  }

  persist() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  nextId(collection) {
    const list = this.data[collection] ?? [];
    return list.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  }
}

export function seedSnapshot() {
  return structuredClone(SEED);
}
