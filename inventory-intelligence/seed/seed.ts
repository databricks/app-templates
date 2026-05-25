import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const hasEnvVars = process.env.PGHOST && process.env.PGPASSWORD;

if (!DATABASE_URL && !hasEnvVars) {
  console.error(
    "Set DATABASE_URL or PGHOST+PGUSER+PGPASSWORD+PGDATABASE env vars.",
  );
  process.exit(1);
}

const client = DATABASE_URL
  ? new pg.Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new pg.Client({ ssl: { rejectUnauthorized: false } });

async function query(sql: string, params?: unknown[]) {
  return client.query(sql, params);
}

const STORES = [
  {
    id: "s1",
    name: "Chicago Flagship",
    region: "Midwest",
    city: "Chicago",
    timezone: "America/Chicago",
  },
  {
    id: "s2",
    name: "Austin South",
    region: "South",
    city: "Austin",
    timezone: "America/Chicago",
  },
  {
    id: "s3",
    name: "Seattle Pike",
    region: "West",
    city: "Seattle",
    timezone: "America/Los_Angeles",
  },
  {
    id: "s4",
    name: "Boston Harbor",
    region: "Northeast",
    city: "Boston",
    timezone: "America/New_York",
  },
  {
    id: "s5",
    name: "Phoenix Desert",
    region: "Southwest",
    city: "Phoenix",
    timezone: "America/Phoenix",
  },
];

const PRODUCTS = [
  // Electronics
  {
    id: "p01",
    sku: "ELEC-001",
    name: "Wireless Earbuds Pro",
    category: "Electronics",
    unit_cost_cents: 4999,
    reorder_point: 20,
    reorder_quantity: 50,
    lead_time_days: 7,
  },
  {
    id: "p02",
    sku: "ELEC-002",
    name: "Smart Watch Series 3",
    category: "Electronics",
    unit_cost_cents: 14999,
    reorder_point: 10,
    reorder_quantity: 25,
    lead_time_days: 10,
  },
  {
    id: "p03",
    sku: "ELEC-003",
    name: "Portable Charger 20000mAh",
    category: "Electronics",
    unit_cost_cents: 2999,
    reorder_point: 30,
    reorder_quantity: 60,
    lead_time_days: 5,
  },
  {
    id: "p04",
    sku: "ELEC-004",
    name: "Bluetooth Speaker Mini",
    category: "Electronics",
    unit_cost_cents: 3999,
    reorder_point: 25,
    reorder_quantity: 50,
    lead_time_days: 7,
  },
  {
    id: "p05",
    sku: "ELEC-005",
    name: "USB-C Hub 7-in-1",
    category: "Electronics",
    unit_cost_cents: 5999,
    reorder_point: 15,
    reorder_quantity: 40,
    lead_time_days: 7,
  },
  // Apparel
  {
    id: "p06",
    sku: "APRL-001",
    name: "Classic Crewneck Hoodie",
    category: "Apparel",
    unit_cost_cents: 4500,
    reorder_point: 40,
    reorder_quantity: 100,
    lead_time_days: 14,
  },
  {
    id: "p07",
    sku: "APRL-002",
    name: "Performance Running Shorts",
    category: "Apparel",
    unit_cost_cents: 2800,
    reorder_point: 35,
    reorder_quantity: 80,
    lead_time_days: 14,
  },
  {
    id: "p08",
    sku: "APRL-003",
    name: "Merino Wool Beanie",
    category: "Apparel",
    unit_cost_cents: 1800,
    reorder_point: 50,
    reorder_quantity: 120,
    lead_time_days: 10,
  },
  {
    id: "p09",
    sku: "APRL-004",
    name: "Waterproof Trail Jacket",
    category: "Apparel",
    unit_cost_cents: 8900,
    reorder_point: 15,
    reorder_quantity: 40,
    lead_time_days: 21,
  },
  {
    id: "p10",
    sku: "APRL-005",
    name: "Yoga Pants High-Waist",
    category: "Apparel",
    unit_cost_cents: 3500,
    reorder_point: 30,
    reorder_quantity: 80,
    lead_time_days: 14,
  },
  // Home & Garden
  {
    id: "p11",
    sku: "HOME-001",
    name: 'Cast Iron Skillet 12"',
    category: "Home & Garden",
    unit_cost_cents: 4200,
    reorder_point: 20,
    reorder_quantity: 40,
    lead_time_days: 7,
  },
  {
    id: "p12",
    sku: "HOME-002",
    name: "Bamboo Cutting Board Set",
    category: "Home & Garden",
    unit_cost_cents: 2200,
    reorder_point: 25,
    reorder_quantity: 60,
    lead_time_days: 7,
  },
  {
    id: "p13",
    sku: "HOME-003",
    name: "Stainless Steel Water Bottle",
    category: "Home & Garden",
    unit_cost_cents: 1900,
    reorder_point: 40,
    reorder_quantity: 100,
    lead_time_days: 5,
  },
  {
    id: "p14",
    sku: "HOME-004",
    name: "Soy Wax Candle Set",
    category: "Home & Garden",
    unit_cost_cents: 2800,
    reorder_point: 30,
    reorder_quantity: 75,
    lead_time_days: 7,
  },
  {
    id: "p15",
    sku: "HOME-005",
    name: "Herb Garden Starter Kit",
    category: "Home & Garden",
    unit_cost_cents: 3400,
    reorder_point: 20,
    reorder_quantity: 50,
    lead_time_days: 10,
  },
  // Sports & Fitness
  {
    id: "p16",
    sku: "SPRT-001",
    name: "Resistance Band Set (5pc)",
    category: "Sports",
    unit_cost_cents: 2400,
    reorder_point: 30,
    reorder_quantity: 80,
    lead_time_days: 5,
  },
  {
    id: "p17",
    sku: "SPRT-002",
    name: "Foam Roller Pro",
    category: "Sports",
    unit_cost_cents: 2900,
    reorder_point: 20,
    reorder_quantity: 50,
    lead_time_days: 7,
  },
  {
    id: "p18",
    sku: "SPRT-003",
    name: "Jump Rope Speed Cable",
    category: "Sports",
    unit_cost_cents: 1500,
    reorder_point: 40,
    reorder_quantity: 100,
    lead_time_days: 5,
  },
  {
    id: "p19",
    sku: "SPRT-004",
    name: "Yoga Mat Premium 6mm",
    category: "Sports",
    unit_cost_cents: 4800,
    reorder_point: 20,
    reorder_quantity: 50,
    lead_time_days: 10,
  },
  {
    id: "p20",
    sku: "SPRT-005",
    name: "Adjustable Dumbbell Pair",
    category: "Sports",
    unit_cost_cents: 12900,
    reorder_point: 8,
    reorder_quantity: 20,
    lead_time_days: 14,
  },
  // Grocery & Pantry
  {
    id: "p21",
    sku: "GROC-001",
    name: "Cold Brew Coffee Concentrate",
    category: "Grocery",
    unit_cost_cents: 1200,
    reorder_point: 60,
    reorder_quantity: 150,
    lead_time_days: 3,
  },
  {
    id: "p22",
    sku: "GROC-002",
    name: "Organic Protein Powder 2lb",
    category: "Grocery",
    unit_cost_cents: 4500,
    reorder_point: 30,
    reorder_quantity: 80,
    lead_time_days: 5,
  },
  {
    id: "p23",
    sku: "GROC-003",
    name: "Raw Honey 16oz",
    category: "Grocery",
    unit_cost_cents: 1800,
    reorder_point: 40,
    reorder_quantity: 100,
    lead_time_days: 3,
  },
  {
    id: "p24",
    sku: "GROC-004",
    name: "Mixed Nut Trail Mix 1lb",
    category: "Grocery",
    unit_cost_cents: 1100,
    reorder_point: 50,
    reorder_quantity: 120,
    lead_time_days: 3,
  },
  {
    id: "p25",
    sku: "GROC-005",
    name: "Matcha Green Tea Powder",
    category: "Grocery",
    unit_cost_cents: 2200,
    reorder_point: 35,
    reorder_quantity: 90,
    lead_time_days: 5,
  },
];

// Base daily sales by store (units/day before seasonal adjustment)
const BASE_DAILY_SALES: Record<string, Record<string, number>> = {
  s1: {
    p01: 3.2,
    p02: 1.1,
    p03: 4.5,
    p04: 2.8,
    p05: 2.1,
    p06: 5.2,
    p07: 4.1,
    p08: 6.3,
    p09: 1.8,
    p10: 3.9,
    p11: 2.4,
    p12: 3.1,
    p13: 5.8,
    p14: 3.5,
    p15: 2.2,
    p16: 4.2,
    p17: 2.9,
    p18: 5.1,
    p19: 2.7,
    p20: 0.9,
    p21: 8.2,
    p22: 3.5,
    p23: 4.8,
    p24: 6.1,
    p25: 3.3,
  },
  s2: {
    p01: 2.5,
    p02: 0.9,
    p03: 3.8,
    p04: 2.3,
    p05: 1.7,
    p06: 3.1,
    p07: 5.2,
    p08: 2.8,
    p09: 0.8,
    p10: 4.5,
    p11: 1.9,
    p12: 2.7,
    p13: 4.9,
    p14: 2.8,
    p15: 2.9,
    p16: 5.1,
    p17: 3.2,
    p18: 6.2,
    p19: 3.4,
    p20: 1.1,
    p21: 7.1,
    p22: 4.2,
    p23: 3.9,
    p24: 5.3,
    p25: 2.8,
  },
  s3: {
    p01: 4.1,
    p02: 1.5,
    p03: 5.2,
    p04: 3.4,
    p05: 2.8,
    p06: 4.5,
    p07: 3.8,
    p08: 5.1,
    p09: 2.6,
    p10: 3.2,
    p11: 2.8,
    p12: 3.5,
    p13: 6.2,
    p14: 3.9,
    p15: 3.5,
    p16: 3.5,
    p17: 2.5,
    p18: 4.3,
    p19: 3.1,
    p20: 0.8,
    p21: 9.1,
    p22: 4.8,
    p23: 5.2,
    p24: 6.8,
    p25: 4.5,
  },
  s4: {
    p01: 2.9,
    p02: 1.2,
    p03: 4.1,
    p04: 2.5,
    p05: 1.9,
    p06: 4.8,
    p07: 2.9,
    p08: 7.2,
    p09: 2.1,
    p10: 2.9,
    p11: 2.1,
    p12: 2.9,
    p13: 5.1,
    p14: 3.1,
    p15: 1.8,
    p16: 3.1,
    p17: 2.2,
    p18: 4.1,
    p19: 2.4,
    p20: 0.7,
    p21: 7.5,
    p22: 3.1,
    p23: 4.1,
    p24: 5.5,
    p25: 2.9,
  },
  s5: {
    p01: 2.1,
    p02: 0.8,
    p03: 3.2,
    p04: 1.9,
    p05: 1.4,
    p06: 2.2,
    p07: 4.8,
    p08: 2.1,
    p09: 0.5,
    p10: 3.8,
    p11: 1.5,
    p12: 2.1,
    p13: 4.2,
    p14: 2.2,
    p15: 2.5,
    p16: 4.8,
    p17: 2.8,
    p18: 5.5,
    p19: 2.8,
    p20: 0.9,
    p21: 6.2,
    p22: 3.8,
    p23: 3.5,
    p24: 4.8,
    p25: 2.4,
  },
};

function gaussianRandom(mean: number, std: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, Math.round(mean + std * z));
}

function weekendMultiplier(date: Date): number {
  const day = date.getDay();
  return day === 0 || day === 6 ? 1.4 : 1.0;
}

function seasonalMultiplier(date: Date, category: string): number {
  const month = date.getMonth();
  if (category === "Apparel") {
    // peaks in spring and fall
    return [0.9, 0.9, 1.1, 1.2, 1.1, 0.9, 0.9, 1.0, 1.1, 1.3, 1.2, 1.0][month];
  }
  if (category === "Sports") {
    // peaks in Jan (resolutions) and summer
    return [1.3, 1.2, 1.1, 1.0, 1.0, 1.2, 1.3, 1.2, 1.0, 0.9, 0.9, 1.0][month];
  }
  if (category === "Grocery") {
    return [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.1, 1.0, 1.0, 1.1, 1.2][month];
  }
  return 1.0;
}

async function createSchema() {
  await query(`CREATE SCHEMA IF NOT EXISTS inventory`);
  await query(`
    CREATE TABLE IF NOT EXISTS inventory.stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      city TEXT NOT NULL,
      timezone TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS inventory.products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit_cost_cents INTEGER NOT NULL,
      reorder_point INTEGER NOT NULL,
      reorder_quantity INTEGER NOT NULL,
      lead_time_days INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS inventory.stock_levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id TEXT NOT NULL REFERENCES inventory.stores(id),
      product_id TEXT NOT NULL REFERENCES inventory.products(id),
      quantity_on_hand INTEGER NOT NULL DEFAULT 0,
      quantity_on_order INTEGER NOT NULL DEFAULT 0,
      last_counted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(store_id, product_id)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS inventory.sales_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id TEXT NOT NULL REFERENCES inventory.stores(id),
      product_id TEXT NOT NULL REFERENCES inventory.products(id),
      quantity_sold INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      sold_at TIMESTAMPTZ NOT NULL
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS inventory.replenishment_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id TEXT NOT NULL REFERENCES inventory.stores(id),
      product_id TEXT NOT NULL REFERENCES inventory.products(id),
      quantity_ordered INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ordered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expected_delivery_at TIMESTAMPTZ,
      notes TEXT
    )
  `);
  console.log("Schema and tables created.");
}

async function seedStores() {
  for (const s of STORES) {
    await query(
      `INSERT INTO inventory.stores (id, name, region, city, timezone) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name, s.region, s.city, s.timezone],
    );
  }
  console.log(`Seeded ${STORES.length} stores.`);
}

async function seedProducts() {
  for (const p of PRODUCTS) {
    await query(
      `INSERT INTO inventory.products (id, sku, name, category, unit_cost_cents, reorder_point, reorder_quantity, lead_time_days) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [
        p.id,
        p.sku,
        p.name,
        p.category,
        p.unit_cost_cents,
        p.reorder_point,
        p.reorder_quantity,
        p.lead_time_days,
      ],
    );
  }
  console.log(`Seeded ${PRODUCTS.length} products.`);
}

async function seedSalesHistory() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 90);

  let totalTx = 0;
  const BATCH_SIZE = 500;

  const rows: [string, string, number, number, string][] = [];

  for (const store of STORES) {
    for (const product of PRODUCTS) {
      const baseSales = BASE_DAILY_SALES[store.id]?.[product.id] ?? 1.0;
      const current = new Date(start);

      while (current < now) {
        const seasonMult = seasonalMultiplier(current, product.category);
        const weekMult = weekendMultiplier(current);
        const mean = baseSales * seasonMult * weekMult;
        const units = gaussianRandom(mean, mean * 0.3);

        if (units > 0) {
          const hour = 8 + Math.floor(Math.random() * 12);
          const saleTime = new Date(current);
          saleTime.setHours(hour, Math.floor(Math.random() * 60), 0, 0);
          const price = Math.round(
            product.unit_cost_cents * (1.4 + Math.random() * 0.3),
          );
          rows.push([
            store.id,
            product.id,
            units,
            price,
            saleTime.toISOString(),
          ]);
          totalTx++;
        }

        current.setDate(current.getDate() + 1);
      }
    }
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = batch
      .map(
        (_, j) =>
          `($${j * 5 + 1},$${j * 5 + 2},$${j * 5 + 3},$${j * 5 + 4},$${j * 5 + 5})`,
      )
      .join(",");
    await query(
      `INSERT INTO inventory.sales_transactions (store_id, product_id, quantity_sold, unit_price_cents, sold_at) VALUES ${placeholders}`,
      batch.flat(),
    );
  }

  console.log(`Seeded ${totalTx} sales transactions (90 days of history).`);
}

async function seedStockLevels() {
  // Current stock: roughly 14-30 days of supply, some critically low
  for (const store of STORES) {
    for (const product of PRODUCTS) {
      const baseSales = BASE_DAILY_SALES[store.id]?.[product.id] ?? 1.0;
      const avgDailyUnits = Math.round(baseSales);

      // Vary stock health: ~20% low, ~10% critical, rest healthy
      const rand = Math.random();
      let daysOfSupply: number;
      let onOrder = 0;

      if (rand < 0.1) {
        // Critical — below reorder point, no order placed yet
        daysOfSupply = Math.floor(Math.random() * 5);
      } else if (rand < 0.25) {
        // Low — near reorder point
        daysOfSupply = 5 + Math.floor(Math.random() * 7);
        onOrder = rand < 0.18 ? 0 : product.reorder_quantity;
      } else {
        // Healthy
        daysOfSupply = 14 + Math.floor(Math.random() * 30);
      }

      const onHand = Math.max(
        0,
        avgDailyUnits * daysOfSupply + Math.floor(Math.random() * 5),
      );

      await query(
        `INSERT INTO inventory.stock_levels (store_id, product_id, quantity_on_hand, quantity_on_order, last_counted_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (store_id, product_id) DO UPDATE
         SET quantity_on_hand = EXCLUDED.quantity_on_hand,
             quantity_on_order = EXCLUDED.quantity_on_order,
             last_counted_at = NOW()`,
        [store.id, product.id, onHand, onOrder],
      );
    }
  }

  console.log(
    `Seeded stock levels for ${STORES.length * PRODUCTS.length} store-product pairs.`,
  );
}

async function seedReplenishmentOrders() {
  // A few open replenishment orders already in flight
  const inFlight = [
    {
      store_id: "s1",
      product_id: "p08",
      quantity_ordered: 120,
      status: "shipped",
      days_ago: 2,
      lead_days: 2,
    },
    {
      store_id: "s3",
      product_id: "p21",
      quantity_ordered: 150,
      status: "ordered",
      days_ago: 1,
      lead_days: 3,
    },
    {
      store_id: "s2",
      product_id: "p06",
      quantity_ordered: 100,
      status: "ordered",
      days_ago: 3,
      lead_days: 14,
    },
    {
      store_id: "s5",
      product_id: "p16",
      quantity_ordered: 80,
      status: "shipped",
      days_ago: 1,
      lead_days: 5,
    },
    {
      store_id: "s4",
      product_id: "p13",
      quantity_ordered: 100,
      status: "ordered",
      days_ago: 2,
      lead_days: 5,
    },
  ];

  for (const o of inFlight) {
    const orderedAt = new Date();
    orderedAt.setDate(orderedAt.getDate() - o.days_ago);

    const expectedDelivery = new Date(orderedAt);
    expectedDelivery.setDate(expectedDelivery.getDate() + o.lead_days);

    await query(
      `INSERT INTO inventory.replenishment_orders (store_id, product_id, quantity_ordered, status, ordered_at, expected_delivery_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        o.store_id,
        o.product_id,
        o.quantity_ordered,
        o.status,
        orderedAt.toISOString(),
        expectedDelivery.toISOString(),
      ],
    );
  }

  console.log(`Seeded ${inFlight.length} in-flight replenishment orders.`);
}

// ── In-memory analytics helpers ───────────────────────────────────────────────
// These match the logic in the DLT gold views so the app works immediately,
// even before the full pipeline (data_generator → DLT → Sync Tables) has run.

interface StoreRow {
  id: string;
  name: string;
  region: string;
  city: string;
  timezone: string;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit_cost_cents: number;
  reorder_point: number;
  reorder_quantity: number;
  lead_time_days: number;
}

interface StockRow {
  store_id: string;
  product_id: string;
  quantity_on_hand: number;
  quantity_on_order: number;
}

function computeStockStatus(
  onHand: number,
  reorderPoint: number,
): "ok" | "low" | "critical" | "out_of_stock" {
  if (onHand <= 0) return "out_of_stock";
  if (onHand <= reorderPoint * 0.5) return "critical";
  if (onHand <= reorderPoint) return "low";
  return "ok";
}

async function seedGoldSchema() {
  await query(`CREATE SCHEMA IF NOT EXISTS gold`);

  await query(`
    CREATE TABLE IF NOT EXISTS gold.inventory_overview_sync (
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      region TEXT NOT NULL,
      product_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit_cost_cents INTEGER NOT NULL,
      reorder_point INTEGER NOT NULL,
      reorder_quantity INTEGER NOT NULL,
      lead_time_days INTEGER NOT NULL,
      quantity_on_hand INTEGER NOT NULL,
      quantity_on_order INTEGER NOT NULL,
      last_counted_at TIMESTAMPTZ NOT NULL,
      avg_daily_units_30d NUMERIC(10,4) NOT NULL,
      units_7d INTEGER NOT NULL,
      units_30d INTEGER NOT NULL,
      days_of_supply NUMERIC(10,1),
      stock_status TEXT NOT NULL,
      PRIMARY KEY (store_id, product_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS gold.replenishment_recommendations_sync (
      store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      forecast_30d_units NUMERIC(10,2) NOT NULL,
      recommended_order_qty INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      model_used TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (store_id, product_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS gold.low_stock_alerts_sync (
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      region TEXT NOT NULL,
      product_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity_on_hand INTEGER NOT NULL,
      quantity_on_order INTEGER NOT NULL,
      reorder_point INTEGER NOT NULL,
      reorder_quantity INTEGER NOT NULL,
      lead_time_days INTEGER NOT NULL,
      avg_daily_units_30d NUMERIC(10,4) NOT NULL,
      days_of_supply NUMERIC(10,1),
      stock_status TEXT NOT NULL,
      PRIMARY KEY (store_id, product_id)
    )
  `);

  console.log("Gold schema and tables created.");
}

async function seedGoldTables() {
  // Fetch operational data to compute analytics
  const storesResult = await query(
    `SELECT id, name, region, city, timezone FROM inventory.stores`,
  );
  const productsResult = await query(
    `SELECT id, sku, name, category, unit_cost_cents, reorder_point, reorder_quantity, lead_time_days FROM inventory.products`,
  );
  const stockResult = await query(
    `SELECT store_id, product_id, quantity_on_hand, quantity_on_order, last_counted_at FROM inventory.stock_levels`,
  );

  const storeMap = new Map<string, StoreRow>(
    (storesResult.rows as StoreRow[]).map((s) => [s.id, s]),
  );
  const productMap = new Map<string, ProductRow>(
    (productsResult.rows as ProductRow[]).map((p) => [p.id, p]),
  );

  // Compute 30d and 7d sales from sales_transactions
  const sales30dResult = await query(`
    SELECT store_id, product_id,
      SUM(quantity_sold) AS units_30d,
      SUM(quantity_sold)::numeric / 30.0 AS avg_daily_units_30d
    FROM inventory.sales_transactions
    WHERE sold_at >= NOW() - INTERVAL '30 days'
    GROUP BY store_id, product_id
  `);
  const sales7dResult = await query(`
    SELECT store_id, product_id, SUM(quantity_sold) AS units_7d
    FROM inventory.sales_transactions
    WHERE sold_at >= NOW() - INTERVAL '7 days'
    GROUP BY store_id, product_id
  `);

  const sales30d = new Map<
    string,
    { units_30d: number; avg_daily_units_30d: number }
  >();
  for (const row of sales30dResult.rows as {
    store_id: string;
    product_id: string;
    units_30d: string;
    avg_daily_units_30d: string;
  }[]) {
    sales30d.set(`${row.store_id}:${row.product_id}`, {
      units_30d: Number(row.units_30d),
      avg_daily_units_30d: Number(row.avg_daily_units_30d),
    });
  }
  const sales7d = new Map<string, number>();
  for (const row of sales7dResult.rows as {
    store_id: string;
    product_id: string;
    units_7d: string;
  }[]) {
    sales7d.set(`${row.store_id}:${row.product_id}`, Number(row.units_7d));
  }

  // Truncate and re-seed gold tables
  await query(`TRUNCATE gold.inventory_overview_sync`);
  await query(`TRUNCATE gold.replenishment_recommendations_sync`);
  await query(`TRUNCATE gold.low_stock_alerts_sync`);

  const overviewRows: unknown[][] = [];
  const recRows: unknown[][] = [];
  const alertRows: unknown[][] = [];
  const now = new Date();

  for (const stock of stockResult.rows as (StockRow & {
    last_counted_at: Date;
  })[]) {
    const store = storeMap.get(stock.store_id);
    const product = productMap.get(stock.product_id);
    if (!store || !product) continue;

    const key = `${stock.store_id}:${stock.product_id}`;
    const s30 = sales30d.get(key) ?? { units_30d: 0, avg_daily_units_30d: 0 };
    const u7d = sales7d.get(key) ?? 0;
    const avgDaily = s30.avg_daily_units_30d;
    const daysOfSupply =
      avgDaily > 0
        ? Math.round((stock.quantity_on_hand / avgDaily) * 10) / 10
        : null;
    const status = computeStockStatus(
      stock.quantity_on_hand,
      product.reorder_point,
    );

    overviewRows.push([
      stock.store_id,
      store.name,
      store.region,
      stock.product_id,
      product.sku,
      product.name,
      product.category,
      product.unit_cost_cents,
      product.reorder_point,
      product.reorder_quantity,
      product.lead_time_days,
      stock.quantity_on_hand,
      stock.quantity_on_order,
      stock.last_counted_at,
      avgDaily,
      u7d,
      s30.units_30d,
      daysOfSupply,
      status,
    ]);

    // Simple weighted moving average forecast
    const forecast30d = Math.round(s30.units_30d * 1.05);
    const confidence =
      s30.units_30d > product.reorder_quantity * 2
        ? "high"
        : s30.units_30d > 0
          ? "medium"
          : "low";
    const recommendedQty = Math.max(
      0,
      forecast30d +
        product.reorder_quantity -
        stock.quantity_on_hand -
        stock.quantity_on_order,
    );

    recRows.push([
      stock.store_id,
      stock.product_id,
      forecast30d,
      recommendedQty,
      confidence,
      "weighted_moving_average",
      now,
    ]);

    if (
      (status === "critical" ||
        status === "out_of_stock" ||
        status === "low") &&
      stock.quantity_on_order === 0
    ) {
      alertRows.push([
        stock.store_id,
        store.name,
        store.region,
        stock.product_id,
        product.sku,
        product.name,
        product.category,
        stock.quantity_on_hand,
        stock.quantity_on_order,
        product.reorder_point,
        product.reorder_quantity,
        product.lead_time_days,
        avgDaily,
        daysOfSupply,
        status,
      ]);
    }
  }

  // Batch insert overview
  const BATCH = 50;
  for (let i = 0; i < overviewRows.length; i += BATCH) {
    const batch = overviewRows.slice(i, i + BATCH);
    const placeholders = batch
      .map(
        (_, j) =>
          `(${Array.from({ length: 19 }, (_, k) => `$${j * 19 + k + 1}`).join(",")})`,
      )
      .join(",");
    await query(
      `INSERT INTO gold.inventory_overview_sync VALUES ${placeholders} ON CONFLICT (store_id, product_id) DO UPDATE SET
        store_name=EXCLUDED.store_name, region=EXCLUDED.region, sku=EXCLUDED.sku,
        product_name=EXCLUDED.product_name, category=EXCLUDED.category,
        unit_cost_cents=EXCLUDED.unit_cost_cents, reorder_point=EXCLUDED.reorder_point,
        reorder_quantity=EXCLUDED.reorder_quantity, lead_time_days=EXCLUDED.lead_time_days,
        quantity_on_hand=EXCLUDED.quantity_on_hand, quantity_on_order=EXCLUDED.quantity_on_order,
        last_counted_at=EXCLUDED.last_counted_at, avg_daily_units_30d=EXCLUDED.avg_daily_units_30d,
        units_7d=EXCLUDED.units_7d, units_30d=EXCLUDED.units_30d,
        days_of_supply=EXCLUDED.days_of_supply, stock_status=EXCLUDED.stock_status`,
      batch.flat(),
    );
  }

  // Batch insert recommendations
  for (let i = 0; i < recRows.length; i += BATCH) {
    const batch = recRows.slice(i, i + BATCH);
    const placeholders = batch
      .map(
        (_, j) =>
          `(${Array.from({ length: 7 }, (_, k) => `$${j * 7 + k + 1}`).join(",")})`,
      )
      .join(",");
    await query(
      `INSERT INTO gold.replenishment_recommendations_sync VALUES ${placeholders} ON CONFLICT (store_id, product_id) DO UPDATE SET
        forecast_30d_units=EXCLUDED.forecast_30d_units, recommended_order_qty=EXCLUDED.recommended_order_qty,
        confidence=EXCLUDED.confidence, model_used=EXCLUDED.model_used, generated_at=EXCLUDED.generated_at`,
      batch.flat(),
    );
  }

  // Batch insert alerts
  for (let i = 0; i < alertRows.length; i += BATCH) {
    const batch = alertRows.slice(i, i + BATCH);
    const placeholders = batch
      .map(
        (_, j) =>
          `(${Array.from({ length: 15 }, (_, k) => `$${j * 15 + k + 1}`).join(",")})`,
      )
      .join(",");
    await query(
      `INSERT INTO gold.low_stock_alerts_sync VALUES ${placeholders} ON CONFLICT (store_id, product_id) DO UPDATE SET
        store_name=EXCLUDED.store_name, region=EXCLUDED.region, sku=EXCLUDED.sku,
        product_name=EXCLUDED.product_name, category=EXCLUDED.category,
        quantity_on_hand=EXCLUDED.quantity_on_hand, quantity_on_order=EXCLUDED.quantity_on_order,
        reorder_point=EXCLUDED.reorder_point, reorder_quantity=EXCLUDED.reorder_quantity,
        lead_time_days=EXCLUDED.lead_time_days, avg_daily_units_30d=EXCLUDED.avg_daily_units_30d,
        days_of_supply=EXCLUDED.days_of_supply, stock_status=EXCLUDED.stock_status`,
      batch.flat(),
    );
  }

  console.log(
    `Seeded gold tables: ${overviewRows.length} overview rows, ${recRows.length} recommendations, ${alertRows.length} alerts.`,
  );
}

async function main() {
  await client.connect();
  console.log("Connected to Lakebase.");

  await createSchema();
  await seedStores();
  await seedProducts();
  await seedSalesHistory();
  await seedStockLevels();
  await seedReplenishmentOrders();

  await seedGoldSchema();
  await seedGoldTables();

  await client.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
