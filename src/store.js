import fs from 'node:fs';
import path from 'node:path';

export const LOW_STOCK_THRESHOLD = 20;

export const COLLECTIONS = [
  'products',
  'customers',
  'suppliers',
  'salesOrders',
  'purchaseOrders',
  'invoices',
  'payments',
  'stockMovements',
];

function isoDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function seedData() {
  return {
    products: [
      {
        id: 1,
        sku: 'MEG-1001',
        name: 'Industrial Bearing 6204',
        category: 'Bearings',
        unitPrice: 12.5,
        cost: 8.4,
        stock: 240,
        reorderPoint: 50,
      },
      {
        id: 2,
        sku: 'MEG-1002',
        name: 'Hydraulic Hose 1m',
        category: 'Hydraulics',
        unitPrice: 34,
        cost: 21,
        stock: 85,
        reorderPoint: 30,
      },
      {
        id: 3,
        sku: 'MEG-1003',
        name: 'Steel Bracket Set',
        category: 'Hardware',
        unitPrice: 8.75,
        cost: 5.2,
        stock: 18,
        reorderPoint: 20,
      },
      {
        id: 4,
        sku: 'MEG-1004',
        name: 'Gear Pump 12V',
        category: 'Hydraulics',
        unitPrice: 96,
        cost: 62,
        stock: 26,
        reorderPoint: 10,
      },
      {
        id: 5,
        sku: 'MEG-1005',
        name: 'Seal Kit',
        category: 'Seals',
        unitPrice: 15.5,
        cost: 9.1,
        stock: 120,
        reorderPoint: 40,
      },
      {
        id: 6,
        sku: 'MEG-1006',
        name: 'Copper Pipe 2m',
        category: 'Plumbing',
        unitPrice: 22.4,
        cost: 13.6,
        stock: 64,
        reorderPoint: 25,
      },
    ],
    customers: [
      { id: 1, name: 'Northwind Traders', email: 'ops@northwind.example', phone: '+1 202 555 0141', city: 'Seattle' },
      { id: 2, name: 'Acme Fabrication', email: 'buying@acme.example', phone: '+1 202 555 0182', city: 'Portland' },
      { id: 3, name: 'Harbour Logistics', email: 'desk@harbour.example', phone: '+1 202 555 0117', city: 'Oakland' },
    ],
    suppliers: [
      { id: 1, name: 'Pacific Bearings', email: 'supply@pacbear.example', phone: '+1 206 555 0110' },
      { id: 2, name: 'Metro Hydraulics', email: 'sales@metrohyd.example', phone: '+1 503 555 0164' },
    ],
    salesOrders: [
      {
        id: 1,
        number: 'SO-0001',
        customerId: 1,
        customerName: 'Northwind Traders',
        status: 'invoiced',
        items: [
          {
            productId: 1,
            sku: 'MEG-1001',
            name: 'Industrial Bearing 6204',
            qty: 10,
            unitPrice: 12.5,
            lineTotal: 125,
          },
        ],
        subtotal: 125,
        taxRate: 0,
        tax: 0,
        total: 125,
        note: '',
        createdAt: isoDaysAgo(6),
        confirmedAt: isoDaysAgo(6),
        invoiceId: 1,
      },
      {
        id: 2,
        number: 'SO-0002',
        customerId: 2,
        customerName: 'Acme Fabrication',
        status: 'confirmed',
        items: [
          {
            productId: 3,
            sku: 'MEG-1003',
            name: 'Steel Bracket Set',
            qty: 4,
            unitPrice: 8.75,
            lineTotal: 35,
          },
        ],
        subtotal: 35,
        taxRate: 0,
        tax: 0,
        total: 35,
        note: '',
        createdAt: isoDaysAgo(2),
        confirmedAt: isoDaysAgo(2),
        invoiceId: null,
      },
    ],
    purchaseOrders: [
      {
        id: 1,
        number: 'PO-0001',
        supplierId: 1,
        supplierName: 'Pacific Bearings',
        status: 'draft',
        items: [
          {
            productId: 1,
            sku: 'MEG-1001',
            name: 'Industrial Bearing 6204',
            qty: 50,
            unitCost: 8.4,
            lineTotal: 420,
          },
        ],
        total: 420,
        note: '',
        createdAt: isoDaysAgo(1),
        receivedAt: null,
      },
    ],
    invoices: [
      {
        id: 1,
        number: 'INV-0001',
        salesOrderId: 1,
        customerId: 1,
        customerName: 'Northwind Traders',
        total: 125,
        paid: 50,
        balance: 75,
        status: 'partial',
        issuedAt: isoDaysAgo(5),
        dueAt: isoDaysAgo(-25),
      },
    ],
    payments: [
      { id: 1, invoiceId: 1, amount: 50, method: 'bank_transfer', note: 'Deposit', paidAt: isoDaysAgo(4) },
    ],
    stockMovements: [
      {
        id: 1,
        productId: 1,
        sku: 'MEG-1001',
        type: 'sale',
        qty: -10,
        balanceAfter: 240,
        reference: 'SO-0001',
        at: isoDaysAgo(6),
      },
      {
        id: 2,
        productId: 3,
        sku: 'MEG-1003',
        type: 'sale',
        qty: -4,
        balanceAfter: 18,
        reference: 'SO-0002',
        at: isoDaysAgo(2),
      },
    ],
  };
}

const SEED = seedData();

function isValid(data) {
  return Boolean(data) && COLLECTIONS.every((name) => Array.isArray(data[name]));
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
        // Corrupt or outdated file: fall back to the seed so the app still starts.
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

  insert(collection, row) {
    const record = { id: this.nextId(collection), ...row };
    this.data[collection].push(record);
    return record;
  }

  find(collection, id) {
    const target = Number(id);
    return (this.data[collection] ?? []).find((row) => row.id === target) ?? null;
  }
}

export function seedSnapshot() {
  return structuredClone(SEED);
}
