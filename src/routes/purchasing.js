import { Router } from 'express';
import { asText, buildLines, httpError, round } from '../util.js';

function requirePurchaseOrder(store, id) {
  const order = store.find('purchaseOrders', id);
  if (!order) throw httpError(404, 'Purchase order not found.');
  return order;
}

export function purchasingRoutes(store) {
  const router = Router();

  router.get('/purchase-orders', (req, res) => {
    const status = asText(req.query.status);
    const orders = store.data.purchaseOrders
      .filter((order) => !status || order.status === status)
      .sort((a, b) => b.id - a.id);
    res.json({ purchaseOrders: orders });
  });

  router.get('/purchase-orders/:id', (req, res) => {
    res.json({ order: requirePurchaseOrder(store, req.params.id) });
  });

  router.post('/purchase-orders', (req, res) => {
    const body = req.body ?? {};
    const supplier = store.find('suppliers', body.supplierId);
    if (!supplier) throw httpError(400, 'Choose an existing supplier for the purchase order.');

    const items = buildLines(store, body.items, 'unitCost');
    const id = store.nextId('purchaseOrders');

    const order = store.insert('purchaseOrders', {
      id,
      number: `PO-${String(id).padStart(4, '0')}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: 'draft',
      items,
      total: round(items.reduce((sum, line) => sum + line.lineTotal, 0)),
      note: asText(body.note),
      createdAt: new Date().toISOString(),
      receivedAt: null,
    });

    store.persist();
    res.status(201).json({ order });
  });

  router.post('/purchase-orders/:id/receive', (req, res) => {
    const order = requirePurchaseOrder(store, req.params.id);
    if (order.status !== 'draft') throw httpError(409, `Order ${order.number} is already ${order.status}.`);

    const at = new Date().toISOString();
    for (const line of order.items) {
      const product = store.find('products', line.productId);
      if (!product) throw httpError(400, `Product ${line.productId} no longer exists.`);
      product.stock += line.qty;
      if (Number.isFinite(line.unitCost)) product.cost = round(line.unitCost);
      store.insert('stockMovements', {
        productId: product.id,
        sku: product.sku,
        type: 'purchase',
        qty: line.qty,
        balanceAfter: product.stock,
        reference: order.number,
        at,
      });
    }

    order.status = 'received';
    order.receivedAt = at;
    store.persist();
    res.json({ order });
  });

  return router;
}
