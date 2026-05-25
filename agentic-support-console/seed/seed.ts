import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const hasEnvVars = process.env.PGHOST && process.env.PGPASSWORD;

if (!DATABASE_URL && !hasEnvVars) {
  console.error('Set DATABASE_URL or PGHOST+PGUSER+PGPASSWORD+PGDATABASE env vars.');
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

const USERS = [
  {
    id: 'u-001',
    name: 'Alice Johnson',
    email: 'alice@example.com',
    region: 'US-West',
  },
  {
    id: 'u-002',
    name: 'Bob Chen',
    email: 'bob@example.com',
    region: 'US-East',
  },
  {
    id: 'u-003',
    name: 'Carol Davis',
    email: 'carol@example.com',
    region: 'EU-West',
  },
  {
    id: 'u-004',
    name: 'David Kim',
    email: 'david@example.com',
    region: 'APAC',
  },
  {
    id: 'u-005',
    name: 'Eva Martinez',
    email: 'eva@example.com',
    region: 'US-West',
  },
];

const ADMINS = [
  { id: 'a-001', name: 'Support Admin', email: 'admin@example.com' },
  { id: 'a-002', name: 'Senior Support', email: 'senior@example.com' },
];

const MENU_ITEMS = [
  {
    id: 'm-001',
    name: 'Pro Plan',
    description: 'Professional subscription plan',
    category: 'subscription',
    price_in_cents: 4999,
  },
  {
    id: 'm-002',
    name: 'Enterprise Plan',
    description: 'Enterprise subscription plan',
    category: 'subscription',
    price_in_cents: 14999,
  },
  {
    id: 'm-003',
    name: 'API Add-on',
    description: 'API access add-on',
    category: 'add-on',
    price_in_cents: 2999,
  },
  {
    id: 'm-004',
    name: 'Storage Add-on',
    description: 'Extra storage add-on',
    category: 'add-on',
    price_in_cents: 999,
  },
  {
    id: 'm-005',
    name: 'Starter Plan',
    description: 'Starter subscription plan',
    category: 'subscription',
    price_in_cents: 1999,
  },
];

const SUPPORT_CASES = [
  {
    userId: 'u-001',
    subject: 'Payment was declined',
    status: 'open' as const,
    messages: [
      {
        role: 'customer',
        content:
          'My payment was declined when trying to upgrade to Pro Plan. My card is valid and has sufficient funds. Can you help?',
      },
    ],
  },
  {
    userId: 'u-002',
    subject: 'Account locked after password reset',
    status: 'open' as const,
    messages: [
      {
        role: 'customer',
        content:
          "I reset my password yesterday and now my account is locked. I've tried logging in multiple times but keep getting an error.",
      },
      {
        role: 'admin',
        content: "I've unlocked your account. Please try logging in again with your new password.",
      },
      {
        role: 'customer',
        content:
          "Still getting the same error. It says 'Account temporarily suspended due to multiple failed login attempts'.",
      },
    ],
  },
  {
    userId: 'u-003',
    subject: 'Billing discrepancy on invoice',
    status: 'in_progress' as const,
    messages: [
      {
        role: 'customer',
        content: 'I was charged $149.99 but my plan should be $49.99/month. This has been going on for 2 months now.',
      },
      {
        role: 'admin',
        content:
          'I see the issue. It looks like an add-on was accidentally applied to your account. Let me investigate further.',
      },
    ],
  },
  {
    userId: 'u-004',
    subject: 'API rate limiting too aggressive',
    status: 'open' as const,
    messages: [
      {
        role: 'customer',
        content:
          "Our application is hitting rate limits even though we're well within our plan's API quota. This is causing production issues for our team.",
      },
    ],
  },
  {
    userId: 'u-005',
    subject: 'Data export not working',
    status: 'open' as const,
    messages: [
      {
        role: 'customer',
        content:
          "I've been trying to export my data for the past 3 days. The export starts but never completes. I need this data for a compliance audit.",
      },
      {
        role: 'admin',
        content:
          "I've identified the issue with the export service. We're working on a fix. In the meantime, I can manually generate the export for you.",
      },
      {
        role: 'customer',
        content: 'That would be great. The audit deadline is next week so I really need it soon.',
      },
    ],
  },
  {
    userId: 'u-001',
    subject: 'Feature request: SSO integration',
    status: 'resolved' as const,
    messages: [
      {
        role: 'customer',
        content: 'We need SSO integration with Okta for our enterprise deployment. Is this on the roadmap?',
      },
      {
        role: 'admin',
        content: 'SSO with Okta is available on the Enterprise Plan. I can help you upgrade if interested.',
      },
      { role: 'customer', content: 'That works, thank you!' },
    ],
  },
  {
    userId: 'u-003',
    subject: 'Service outage impacted our team',
    status: 'open' as const,
    messages: [
      {
        role: 'customer',
        content:
          'The service was down for 4 hours today and our entire team was blocked. We had an important client demo that we had to cancel.',
      },
    ],
  },
];

async function createTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      region TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.admins (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.menu_items (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      price_in_cents INTEGER NOT NULL,
      available BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES public.users(id),
      status TEXT NOT NULL DEFAULT 'completed',
      total_in_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES public.orders(id),
      menu_item_id TEXT NOT NULL REFERENCES public.menu_items(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      price_in_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.support_cases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES public.users(id),
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.support_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID NOT NULL REFERENCES public.support_cases(id),
      user_id TEXT REFERENCES public.users(id),
      admin_id TEXT REFERENCES public.admins(id),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.refunds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES public.users(id),
      order_id UUID REFERENCES public.orders(id),
      support_case_id UUID REFERENCES public.support_cases(id),
      amount_in_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved',
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS public.credits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES public.users(id),
      support_case_id UUID REFERENCES public.support_cases(id),
      amount_in_cents INTEGER NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('Tables created.');
}

async function seedData() {
  for (const u of USERS) {
    await query(
      `INSERT INTO public.users (id, name, email, region) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name, u.email, u.region]
    );
  }
  console.log(`Seeded ${USERS.length} users.`);

  for (const a of ADMINS) {
    await query(`INSERT INTO public.admins (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [
      a.id,
      a.name,
      a.email,
    ]);
  }
  console.log(`Seeded ${ADMINS.length} admins.`);

  for (const m of MENU_ITEMS) {
    await query(
      `INSERT INTO public.menu_items (id, name, description, category, price_in_cents) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [m.id, m.name, m.description, m.category, m.price_in_cents]
    );
  }
  console.log(`Seeded ${MENU_ITEMS.length} menu items.`);

  for (const u of USERS) {
    const itemCount = 1 + Math.floor(Math.random() * 3);
    const items = Array.from({ length: itemCount }, () => MENU_ITEMS[Math.floor(Math.random() * MENU_ITEMS.length)]);
    const total = items.reduce((sum, item) => sum + item.price_in_cents, 0);

    const orderResult = await query(
      `INSERT INTO public.orders (user_id, status, total_in_cents) VALUES ($1, 'completed', $2) RETURNING id`,
      [u.id, total]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      await query(
        `INSERT INTO public.order_items (order_id, menu_item_id, quantity, price_in_cents) VALUES ($1, $2, 1, $3)`,
        [orderId, item.id, item.price_in_cents]
      );
    }
  }
  console.log(`Seeded orders for ${USERS.length} users.`);

  for (const sc of SUPPORT_CASES) {
    const caseResult = await query(
      `INSERT INTO public.support_cases (user_id, subject, status) VALUES ($1, $2, $3) RETURNING id`,
      [sc.userId, sc.subject, sc.status]
    );
    const caseId = caseResult.rows[0].id;

    for (const msg of sc.messages) {
      if (msg.role === 'customer') {
        await query(`INSERT INTO public.support_messages (case_id, user_id, content) VALUES ($1, $2, $3)`, [
          caseId,
          sc.userId,
          msg.content,
        ]);
      } else {
        await query(`INSERT INTO public.support_messages (case_id, admin_id, content) VALUES ($1, $2, $3)`, [
          caseId,
          ADMINS[0].id,
          msg.content,
        ]);
      }
    }
  }
  console.log(`Seeded ${SUPPORT_CASES.length} support cases with messages.`);
}

async function main() {
  await client.connect();
  console.log('Connected to Lakebase.');

  await createTables();
  await seedData();

  await client.end();
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
