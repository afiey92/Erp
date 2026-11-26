import { Router } from 'express';
import { asNumber, asText, buildLines, httpError, round } from '../util.js';

function requireSalesOrder(store, id) {
  const order = store.find('salesOrders', id);
  if (!order) throw httpError(404, 'Sales order not found.');
  return order;
}

function aggregateNeeds(order) {
  const needed = new Map();
  for (const line of order.items) {
    needed.set(line.productId, (needed.get(line.productId) ?? 0) + line.qty);
  }
  return needed;
}

export function salesRoutes(store) {
  const router = Router();

  router.get('/sales-orders', (req, res) => {
    const status = asText(req.query.status);
    const orders = store.data.salesOrders
      .filter((order) => !status || order.status === status)
      .sort((a, b) => b.id - a.id);
    res.json({ salesOrders: orders });
  });

  router.get('/sales-orders/:id', (req, res) => {
    res.json({ order: requireSalesOrder(store, req.params.id) });
  });

  router.post('/sales-orders', (req, res) => {
    const body = req.body ?? {};
    const customer = store.find('customers', body.customerId);
    if (!customer) throw httpError(400, 'Choose an existing customer for the order.');

    const taxRate = asNumber(body.taxRate ?? 0);
    if (taxRate === null || taxRate < 0 || taxRate > 100) {
      throw httpError(400, 'Tax rate must be between 0 and 100.');
    }

    const items = buildLines(store, body.items, 'unitPrice');
    const subtotal = round(items.reduce((sum, line) => sum + line.lineTotal, 0));
    const tax = round((subtotal * taxRate) / 100);
    const id = store.nextId('salesOrders');

    const order = store.insert('salesOrders', {
      id,
      number: `SO-${String(id).padStart(4, '0')}`,
      customerId: customer.id,
      customerName: customer.name,
      status: 'draft',
      items,
      subtotal,
      taxRate,
      tax,
      total: round(subtotal + tax),
      note: asText(body.note),
      createdAt: new Date().toISOString(),
      confirmedAt: null,
      invoiceId: null,
    });

    store.persist();
    res.status(201).json({ order });
  });

  router.post('/sales-orders/:id/confirm', (req, res) => {
    const order = requireSalesOrder(store, req.params.id);
    if (order.status !== 'draft') throw httpError(409, `Order ${order.number} is already ${order.status}.`);

    const needed = aggregateNeeds(order);
    for (const [productId, qty] of needed) {
      const product = store.find('products', productId);
      if (!product) throw httpError(400, `Product ${productId} no longer exists.`);
      if (product.stock < qty) {
        throw httpError(
          409,
          `Insufficient stock for ${product.sku}: ${product.stock} available, ${qty} requested.`,
        );
      }
    }

    const at = new Date().toISOString();
    for (const [productId, qty] of needed) {
      const product = store.find('products', productId);
      product.stock -= qty;
      store.insert('stockMovements', {
        productId,
        sku: product.sku,
        type: 'sale',
        qty: -qty,
        balanceAfter: product.stock,
        reference: order.number,
        at,
      });
    }

    order.status = 'confirmed';
    order.confirmedAt = at;
    store.persist();
    res.json({ order });
  });

  router.post('/sales-orders/:id/cancel', (req, res) => {
    const order = requireSalesOrder(store, req.params.id);
    if (order.status !== 'draft') {
      throw httpError(409, `Only draft orders can be cancelled (order is ${order.status}).`);
    }
    order.status = 'cancelled';
    store.persist();
    res.json({ order });
  });

  router.post('/sales-orders/:id/invoice', (req, res) => {
    const order = requireSalesOrder(store, req.params.id);
    if (order.status !== 'confirmed') {
      throw httpError(409, `Only confirmed orders can be invoiced (order is ${order.status}).`);
    }

    const id = store.nextId('invoices');
    const issuedAt = new Date();
    const dueAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const invoice = store.insert('invoices', {
      id,
      number: `INV-${String(id).padStart(4, '0')}`,
      salesOrderId: order.id,
      customerId: order.customerId,
      customerName: order.customerName,
      total: order.total,
      paid: 0,
      balance: order.total,
      status: 'open',
      issuedAt: issuedAt.toISOString(),
      dueAt: dueAt.toISOString(),
    });

    order.status = 'invoiced';
    order.invoiceId = invoice.id;
    store.persist();
    res.status(201).json({ invoice, order });
  });

  router.get('/invoices', (req, res) => {
    const status = asText(req.query.status);
    const invoices = store.data.invoices
      .filter((invoice) => !status || invoice.status === status)
      .sort((a, b) => b.id - a.id);
    res.json({ invoices });
  });

  router.post('/invoices/:id/payments', (req, res) => {
    const invoice = store.find('invoices', req.params.id);
    if (!invoice) throw httpError(404, 'Invoice not found.');
    if (invoice.status === 'paid') throw httpError(409, `Invoice ${invoice.number} is already paid.`);

    const body = req.body ?? {};
    const amount = asNumber(body.amount);
    if (amount === null || amount <= 0) throw httpError(400, 'Payment amount must be greater than zero.');
    if (amount > invoice.balance) {
      throw httpError(400, `Payment exceeds the outstanding balance of ${invoice.balance}.`);
    }

    const payment = store.insert('payments', {
      invoiceId: invoice.id,
      amount: round(amount),
      method: asText(body.method) || 'bank_transfer',
      note: asText(body.note),
      paidAt: new Date().toISOString(),
    });

    invoice.paid = round(invoice.paid + payment.amount);
    invoice.balance = round(invoice.total - invoice.paid);
    invoice.status = invoice.balance <= 0 ? 'paid' : 'partial';

    if (invoice.status === 'paid') {
      const order = store.find('salesOrders', invoice.salesOrderId);
      if (order) order.status = 'paid';
    }

    store.persist();
    res.status(201).json({ payment, invoice });
  });

  router.get('/payments', (req, res) => {
    res.json({ payments: [...store.data.payments].sort((a, b) => b.id - a.id) });
  });

  return router;
}
