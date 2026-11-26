import { Router } from 'express';
import { LOW_STOCK_THRESHOLD } from '../store.js';
import { asText, round, todayKey } from '../util.js';

const REVENUE_STATUSES = new Set(['confirmed', 'invoiced', 'paid']);

function revenueOrders(store) {
  return store.data.salesOrders.filter((order) => REVENUE_STATUSES.has(order.status));
}

function sumBy(list, pick) {
  return round(list.reduce((sum, row) => sum + pick(row), 0));
}

function isLow(product) {
  const threshold = Number.isFinite(product.reorderPoint) ? product.reorderPoint : LOW_STOCK_THRESHOLD;
  return product.stock <= threshold;
}

function dayOf(iso) {
  return String(iso).slice(0, 10);
}

export function reportsRoutes(store) {
  const router = Router();

  // Legacy shape kept so older clients keep working.
  router.get('/summary', (req, res) => {
    const { products, customers, salesOrders } = store.data;
    const lowStock = products.filter(isLow);
    res.json({
      products,
      customers,
      orders: salesOrders,
      lowStock,
      stats: {
        productCount: products.length,
        customerCount: customers.length,
        orderCount: salesOrders.length,
        revenue: sumBy(revenueOrders(store), (order) => order.total),
        lowStockCount: lowStock.length,
      },
    });
  });

  router.get('/dashboard', (req, res) => {
    const { products, customers, suppliers, invoices, stockMovements, purchaseOrders } = store.data;
    const orders = revenueOrders(store);
    const openInvoices = invoices.filter((invoice) => invoice.status !== 'paid');
    const lowStock = products.filter(isLow);

    const trend = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const key = todayKey(-offset);
      const dayOrders = orders.filter((order) => dayOf(order.createdAt) === key);
      trend.push({
        date: key,
        orders: dayOrders.length,
        revenue: sumBy(dayOrders, (order) => order.total),
      });
    }

    const productTotals = new Map();
    for (const order of orders) {
      for (const line of order.items) {
        const entry = productTotals.get(line.productId) ?? {
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          qty: 0,
          revenue: 0,
        };
        entry.qty += line.qty;
        entry.revenue = round(entry.revenue + line.lineTotal);
        productTotals.set(line.productId, entry);
      }
    }

    res.json({
      stats: {
        revenue: sumBy(orders, (order) => order.total),
        outstanding: sumBy(openInvoices, (invoice) => invoice.balance),
        stockValue: sumBy(products, (product) => product.stock * product.cost),
        productCount: products.length,
        customerCount: customers.length,
        supplierCount: suppliers.length,
        salesOrderCount: store.data.salesOrders.length,
        purchaseOrderCount: purchaseOrders.length,
        openInvoiceCount: openInvoices.length,
        lowStockCount: lowStock.length,
      },
      trend,
      topProducts: [...productTotals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      lowStock,
      recentMovements: [...stockMovements]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id - a.id)
        .slice(0, 8),
      openInvoices: [...openInvoices]
        .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
        .slice(0, 5),
    });
  });

  router.get('/stock-movements', (req, res) => {
    const productId = Number(req.query.productId);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = store.data.stockMovements
      .filter((movement) => !productId || movement.productId === productId)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.id - a.id)
      .slice(0, limit);
    res.json({ stockMovements: rows });
  });

  router.get('/reports/sales', (req, res) => {
    const from = asText(req.query.from) || todayKey(-29);
    const to = asText(req.query.to) || todayKey(0);
    const orders = revenueOrders(store).filter((order) => {
      const key = dayOf(order.createdAt);
      return key >= from && key <= to;
    });

    const byDay = new Map();
    const byProduct = new Map();
    const byCustomer = new Map();

    for (const order of orders) {
      const key = dayOf(order.createdAt);
      const day = byDay.get(key) ?? { date: key, orders: 0, revenue: 0 };
      day.orders += 1;
      day.revenue = round(day.revenue + order.total);
      byDay.set(key, day);

      const customer = byCustomer.get(order.customerId) ?? {
        customerId: order.customerId,
        customer: order.customerName,
        orders: 0,
        revenue: 0,
      };
      customer.orders += 1;
      customer.revenue = round(customer.revenue + order.total);
      byCustomer.set(order.customerId, customer);

      for (const line of order.items) {
        const product = byProduct.get(line.productId) ?? {
          productId: line.productId,
          sku: line.sku,
          name: line.name,
          qty: 0,
          revenue: 0,
        };
        product.qty += line.qty;
        product.revenue = round(product.revenue + line.lineTotal);
        byProduct.set(line.productId, product);
      }
    }

    const revenue = sumBy(orders, (order) => order.total);
    res.json({
      range: { from, to },
      totals: {
        orderCount: orders.length,
        revenue,
        tax: sumBy(orders, (order) => order.tax),
        averageOrder: orders.length ? round(revenue / orders.length) : 0,
      },
      byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
      byCustomer: [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue),
    });
  });

  router.get('/reports/inventory', (req, res) => {
    const { products } = store.data;
    res.json({
      products: products.map((product) => ({
        ...product,
        stockValue: round(product.stock * product.cost),
        low: isLow(product),
      })),
      totals: {
        units: products.reduce((sum, product) => sum + product.stock, 0),
        stockValue: sumBy(products, (product) => product.stock * product.cost),
        lowStockCount: products.filter(isLow).length,
      },
    });
  });

  return router;
}
