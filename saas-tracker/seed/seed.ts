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

const SUBSCRIPTIONS = [
  {
    name: "GitHub Enterprise",
    vendor: "GitHub, Inc.",
    description: "Source code hosting and CI/CD",
    category: "Engineering",
    cost_cents: 2100,
    billing_cycle: "monthly",
    owner_name: "Alice Chen",
    owner_email: "alice@company.com",
    department: "Platform",
    license_count: 50,
    status: "active",
    start_date: "2024-01-15",
    renewal_date: "2026-01-15",
    url: "https://github.com/organizations/settings",
  },
  {
    name: "Figma",
    vendor: "Figma, Inc.",
    description: "UI/UX design and prototyping",
    category: "Design",
    cost_cents: 4500,
    billing_cycle: "monthly",
    owner_name: "Maria Santos",
    owner_email: "maria@company.com",
    department: "Product Design",
    license_count: 15,
    status: "active",
    start_date: "2024-03-01",
    renewal_date: "2026-05-01",
  },
  {
    name: "Slack Business+",
    vendor: "Salesforce",
    description: "Team communication",
    category: "Operations",
    cost_cents: 1275,
    billing_cycle: "monthly",
    owner_name: "James Wilson",
    owner_email: "james@company.com",
    department: "IT",
    license_count: 120,
    status: "active",
    start_date: "2023-06-01",
    renewal_date: "2026-06-01",
  },
  {
    name: "Datadog Pro",
    vendor: "Datadog, Inc.",
    description: "Infrastructure monitoring and APM",
    category: "Engineering",
    cost_cents: 2300,
    billing_cycle: "monthly",
    owner_name: "Alice Chen",
    owner_email: "alice@company.com",
    department: "Platform",
    license_count: 30,
    status: "active",
    start_date: "2024-02-01",
    renewal_date: "2026-02-01",
  },
  {
    name: "HubSpot Marketing Hub",
    vendor: "HubSpot, Inc.",
    description: "Marketing automation and CRM",
    category: "Marketing",
    cost_cents: 89000,
    billing_cycle: "annual",
    owner_name: "Sarah Park",
    owner_email: "sarah@company.com",
    department: "Growth Marketing",
    license_count: 10,
    status: "active",
    start_date: "2024-09-01",
    renewal_date: "2026-09-01",
    url: "https://app.hubspot.com/settings",
  },
  {
    name: "Salesforce CRM",
    vendor: "Salesforce",
    description: "Customer relationship management",
    category: "Sales",
    cost_cents: 180000,
    billing_cycle: "annual",
    owner_name: "Tom Rivera",
    owner_email: "tom@company.com",
    department: "Sales Ops",
    license_count: 25,
    status: "active",
    start_date: "2024-04-01",
    renewal_date: "2026-04-15",
    url: "https://company.my.salesforce.com",
  },
  {
    name: "1Password Business",
    vendor: "1Password",
    description: "Password management and secrets",
    category: "Security",
    cost_cents: 799,
    billing_cycle: "monthly",
    owner_name: "James Wilson",
    owner_email: "james@company.com",
    department: "IT",
    license_count: 120,
    status: "active",
    start_date: "2023-08-01",
    renewal_date: "2026-08-01",
  },
  {
    name: "Linear",
    vendor: "Linear Orbit, Inc.",
    description: "Issue tracking and project management",
    category: "Engineering",
    cost_cents: 800,
    billing_cycle: "monthly",
    owner_name: "Alice Chen",
    owner_email: "alice@company.com",
    department: "Platform",
    license_count: 45,
    status: "active",
    start_date: "2024-07-01",
    renewal_date: "2026-07-01",
  },
  {
    name: "Notion Team",
    vendor: "Notion Labs, Inc.",
    description: "Knowledge base and documentation",
    category: "Operations",
    cost_cents: 1000,
    billing_cycle: "monthly",
    owner_name: "Emily Zhang",
    owner_email: "emily@company.com",
    department: "Operations",
    license_count: 80,
    status: "active",
    start_date: "2024-01-01",
    renewal_date: "2026-07-01",
  },
  {
    name: "Greenhouse",
    vendor: "Greenhouse Software",
    description: "Applicant tracking system",
    category: "HR",
    cost_cents: 65000,
    billing_cycle: "annual",
    owner_name: "Lisa Thompson",
    owner_email: "lisa@company.com",
    department: "People Ops",
    license_count: 8,
    status: "active",
    start_date: "2024-06-01",
    renewal_date: "2026-06-01",
  },
  {
    name: "Stripe Atlas",
    vendor: "Stripe, Inc.",
    description: "Payment processing and billing",
    category: "Finance",
    cost_cents: 0,
    billing_cycle: "monthly",
    owner_name: "David Kim",
    owner_email: "david@company.com",
    department: "Finance",
    status: "active",
    start_date: "2023-01-01",
    notes: "Transaction-based pricing, no fixed monthly cost",
  },
  {
    name: "Vercel Pro",
    vendor: "Vercel Inc.",
    description: "Frontend deployment platform",
    category: "Engineering",
    cost_cents: 2000,
    billing_cycle: "monthly",
    owner_name: "Alice Chen",
    owner_email: "alice@company.com",
    department: "Platform",
    license_count: 10,
    status: "active",
    start_date: "2024-05-01",
    renewal_date: "2026-05-01",
  },
  {
    name: "Mixpanel Growth",
    vendor: "Mixpanel, Inc.",
    description: "Product analytics",
    category: "Marketing",
    cost_cents: 125000,
    billing_cycle: "annual",
    owner_name: "Sarah Park",
    owner_email: "sarah@company.com",
    department: "Growth Marketing",
    license_count: 20,
    status: "trial",
    start_date: "2026-03-01",
    renewal_date: "2026-06-01",
    notes: "90-day trial, evaluating vs Amplitude",
  },
  {
    name: "Amplitude",
    vendor: "Amplitude, Inc.",
    description: "Product analytics (evaluating)",
    category: "Marketing",
    cost_cents: 110000,
    billing_cycle: "annual",
    owner_name: "Sarah Park",
    owner_email: "sarah@company.com",
    department: "Growth Marketing",
    status: "trial",
    start_date: "2026-03-15",
    renewal_date: "2026-06-15",
    notes: "Trial alongside Mixpanel",
  },
  {
    name: "Jira Cloud",
    vendor: "Atlassian",
    description: "Legacy issue tracker",
    category: "Engineering",
    cost_cents: 785,
    billing_cycle: "monthly",
    owner_name: "James Wilson",
    owner_email: "james@company.com",
    department: "IT",
    license_count: 50,
    status: "pending_cancellation",
    start_date: "2022-01-01",
    renewal_date: "2026-07-01",
    notes: "Migrating to Linear, cancel at next renewal",
  },
  {
    name: "Confluence",
    vendor: "Atlassian",
    description: "Legacy wiki",
    category: "Operations",
    cost_cents: 585,
    billing_cycle: "monthly",
    owner_name: "James Wilson",
    owner_email: "james@company.com",
    department: "IT",
    license_count: 50,
    status: "pending_cancellation",
    start_date: "2022-01-01",
    renewal_date: "2026-07-01",
    notes: "Migrating to Notion, cancel at next renewal",
  },
  {
    name: "Zendesk Suite",
    vendor: "Zendesk, Inc.",
    description: "Customer support platform",
    category: "Operations",
    cost_cents: 115000,
    billing_cycle: "annual",
    owner_name: "Emily Zhang",
    owner_email: "emily@company.com",
    department: "Customer Success",
    license_count: 12,
    status: "cancelled",
    start_date: "2023-01-01",
    cancellation_date: "2025-12-31",
    notes: "Replaced with internal support console",
  },
  {
    name: "Heroku",
    vendor: "Salesforce",
    description: "Legacy app hosting",
    category: "Engineering",
    cost_cents: 25000,
    billing_cycle: "monthly",
    owner_name: "Alice Chen",
    owner_email: "alice@company.com",
    department: "Platform",
    status: "cancelled",
    start_date: "2021-06-01",
    cancellation_date: "2025-06-01",
    notes: "Migrated to Databricks Apps",
  },
];

async function createTable() {
  await query(`CREATE SCHEMA IF NOT EXISTS saas_tracker`);
  await query(`
    CREATE TABLE IF NOT EXISTS saas_tracker.subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      vendor TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      cost_cents INTEGER NOT NULL,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      currency TEXT NOT NULL DEFAULT 'USD',
      owner_name TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      department TEXT,
      license_count INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      start_date DATE NOT NULL,
      renewal_date DATE,
      cancellation_date DATE,
      url TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("Table created.");
}

async function seedData() {
  for (const s of SUBSCRIPTIONS) {
    await query(
      `INSERT INTO saas_tracker.subscriptions
        (name, vendor, description, category, cost_cents, billing_cycle, owner_name, owner_email,
         department, license_count, status, start_date, renewal_date, cancellation_date, url, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::date, $14::date, $15, $16)`,
      [
        s.name,
        s.vendor,
        s.description ?? null,
        s.category,
        s.cost_cents,
        s.billing_cycle,
        s.owner_name,
        s.owner_email,
        s.department ?? null,
        s.license_count ?? null,
        s.status,
        s.start_date,
        s.renewal_date ?? null,
        s.cancellation_date ?? null,
        s.url ?? null,
        s.notes ?? null,
      ],
    );
  }
  console.log(`Seeded ${SUBSCRIPTIONS.length} subscriptions.`);
}

async function main() {
  await client.connect();
  console.log("Connected to Lakebase.");

  await createTable();
  await seedData();

  await client.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
