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

const GUIDELINES = [
  {
    target: "blog",
    title: "Brand Voice",
    description: "Tone and voice standards for the company blog",
    rules: `- Use professional but approachable tone
- Write in active voice; avoid passive constructions
- No jargon without explanation; define technical terms on first use
- Avoid superlatives ("best", "fastest", "revolutionary") unless backed by data
- Address the reader directly with "you" rather than "users" or "customers"
- Keep sentences under 25 words on average
- Use sentence case for headings, not Title Case`,
    created_by: "moderator@company.com",
  },
  {
    target: "blog",
    title: "Legal Compliance",
    description: "Required disclosures and legal guardrails",
    rules: `- Never make guarantees about product performance or uptime
- Include disclaimers when discussing pricing (e.g. "pricing subject to change")
- Do not reference competitor products by name in negative comparisons
- Avoid forward-looking statements about unannounced features
- Do not share customer data, revenue figures, or internal metrics without approval
- All statistics must include source attribution`,
    created_by: "legal@company.com",
  },
  {
    target: "linkedin",
    title: "LinkedIn Best Practices",
    description: "Guidelines specific to LinkedIn content",
    rules: `- Keep posts under 1,300 characters (LinkedIn truncates at ~210 chars in feed)
- Lead with a hook in the first line; avoid starting with "We are excited to..."
- Use line breaks for readability; avoid wall-of-text posts
- Maximum 3 hashtags per post
- No emoji in the first line
- Tag relevant people or companies sparingly (max 3 tags per post)
- Include a clear call to action
- Do not use "link in comments" pattern; include the URL in the post`,
    created_by: "social@company.com",
  },
  {
    target: "linkedin",
    title: "Brand Voice - Social",
    description: "Social-specific voice guidelines",
    rules: `- More conversational than blog tone, but still professional
- First person plural ("we") is acceptable for company announcements
- Share genuine insights, not marketing fluff
- Do not use engagement bait ("Agree?" "Thoughts?" with nothing else)
- Avoid ALL CAPS for emphasis; use sparingly if at all`,
    created_by: "moderator@company.com",
  },
  {
    target: "twitter",
    title: "Twitter/X Guidelines",
    description: "Short-form content rules",
    rules: `- Maximum 280 characters
- One key message per tweet
- Use threads for longer narratives (max 5 tweets in a thread)
- No more than 2 hashtags
- Avoid negative or confrontational tone
- Respond to mentions within 4 hours during business hours
- Do not engage with trolls or negative accounts`,
    created_by: "social@company.com",
  },
  {
    target: "newsletter",
    title: "Newsletter Standards",
    description: "Email newsletter content guidelines",
    rules: `- Subject line: 6-10 words, no ALL CAPS, no spam trigger words
- Preview text should complement (not repeat) the subject line
- Keep total word count under 600 words
- One primary CTA per newsletter; secondary CTAs are optional
- Personalize where possible (use first name in greeting)
- Include unsubscribe link and company address (CAN-SPAM)
- Test rendering in Outlook, Gmail, and Apple Mail before sending`,
    created_by: "marketing@company.com",
  },
  {
    target: "press_release",
    title: "Press Release Format",
    description: "Standard press release structure and rules",
    rules: `- Follow inverted pyramid structure: most important info first
- Include dateline (city, state, date)
- First paragraph must answer who, what, when, where, why
- Include at least one executive quote
- Keep total length between 400-800 words
- Include boilerplate company description at the end
- All claims must be verifiable; include data sources
- Must be reviewed by legal before publication
- Use formal language; no contractions`,
    created_by: "comms@company.com",
  },
];

const SUBMISSIONS = [
  {
    title: "Introducing Our New Developer Platform",
    body: `We are thrilled to announce the launch of our revolutionary new developer platform that will change the way teams build software forever.

Our platform is the best in the market, offering unprecedented speed and reliability. With our cutting-edge technology, developers can deploy applications 10x faster than any competitor.

Key features:
- Auto-scaling infrastructure
- Built-in CI/CD pipelines
- Real-time collaboration tools

"This is a game-changer for the industry," said our CEO. "No other platform comes close to what we offer."

Contact us today to learn more about pricing and availability.`,
    target: "blog",
    author_name: "Alex Rivera",
    author_email: "alex@company.com",
    status: "pending_review",
  },
  {
    title: "Q2 Product Update: What's New",
    body: `Over the past quarter, our engineering team shipped several improvements to make your workflow smoother.

Here's what changed:

Database Performance
You can now run analytical queries up to 3x faster on datasets over 1TB, based on our internal benchmarks (measured across 50 customer workloads, March 2026). We optimized the query planner to better handle complex joins and window functions.

New Dashboard Builder
Building dashboards no longer requires SQL knowledge. The drag-and-drop builder lets you create visualizations from any connected data source. We've seen early adopters cut dashboard creation time from hours to minutes.

Improved Access Controls
Role-based access now supports custom roles with granular permissions per resource. This was our most-requested feature in Q1.

What's Next
We're working on real-time streaming support and improved notebook collaboration. Stay tuned for updates.

Questions? Reach out to your account team or visit our docs at docs.example.com.`,
    target: "blog",
    author_name: "Priya Sharma",
    author_email: "priya@company.com",
    status: "approved",
  },
  {
    title: "We just hit 10,000 customers!",
    body: `WE ARE EXCITED TO ANNOUNCE that we just crossed 10,000 customers!! 🎉🎉🎉

This has been an incredible journey and we couldn't have done it without each and every one of you.

What started as a small idea in a garage has grown into something truly AMAZING.

If you haven't tried our platform yet, what are you waiting for?? Link in comments 👇

#startup #growth #SaaS #tech #innovation #milestone #celebration #grateful #hustle #entrepreneur`,
    target: "linkedin",
    author_name: "Jordan Lee",
    author_email: "jordan@company.com",
    status: "pending_review",
  },
  {
    title: "Lessons from scaling to 1M requests/sec",
    body: `Three years ago we handled 1,000 requests per second. Today we handle 1 million.

Here are 5 things we learned the hard way:

1. Database connection pooling matters more than you think. We went from 500 to 50,000 concurrent connections just by adding PgBouncer.

2. Cache invalidation is genuinely the hardest problem. We tried TTL-based caching, event-driven invalidation, and hybrid approaches. The hybrid won.

3. Observability is not optional. Every service needs distributed tracing from day one. We use OpenTelemetry and it saved us during three major incidents.

4. Autoscaling needs guardrails. Unlimited autoscaling caused a $40K bill in one weekend. Set upper bounds.

5. Your architecture will change. Accept it. We rewrote our ingestion pipeline twice and our API gateway three times.

The full technical deep-dive is on our blog (link in post).

#engineering #scaling #infrastructure`,
    target: "linkedin",
    author_name: "Sam Chen",
    author_email: "sam@company.com",
    status: "approved",
  },
  {
    title: "New integration with Salesforce",
    body: `Big news! Our platform now integrates directly with Salesforce CRM.

Sync your customer data bidirectionally, trigger workflows from Salesforce events, and build dashboards that combine product analytics with CRM data.

Available today for all Enterprise customers.

Setup guide: docs.example.com/integrations/salesforce`,
    target: "twitter",
    author_name: "Morgan Taylor",
    author_email: "morgan@company.com",
    status: "approved",
  },
  {
    title: "Why we chose Rust for our new service",
    body: `After months of deliberation, we decided to rewrite our most performance-critical service in Rust. Here's why Python wasn't cutting it anymore and what we gained.`,
    target: "twitter",
    author_name: "Sam Chen",
    author_email: "sam@company.com",
    status: "pending_review",
  },
  {
    title: "March Newsletter: Platform Updates & Community Highlights",
    body: `Hi {first_name},

HUGE NEWS INSIDE!! Don't miss out on these EXCLUSIVE updates!!!

This month we're covering:
- The new dashboard builder
- Community spotlight: How Acme Corp uses our platform
- Upcoming events and webinars
- Tips and tricks from our power users

The new dashboard builder is available for all Pro and Enterprise plans. It lets you create beautiful visualizations without writing any code.

We also have three webinars coming up next month. Register at events.example.com.

Don't forget to follow us on social media for daily tips!

Best regards,
The Team

PS: Forward this to a friend and you both get 20% off! Use code FRIEND20.

PPS: Act now, this offer expires in 24 HOURS!!`,
    target: "newsletter",
    author_name: "Lisa Park",
    author_email: "lisa@company.com",
    status: "pending_review",
  },
  {
    title: "Company Secures $50M Series C Funding",
    body: `FOR IMMEDIATE RELEASE

San Francisco, CA - April 1, 2026 - Example Corp, a leading provider of data infrastructure solutions, today announced it has raised $50 million in Series C funding led by Benchmark Capital, with participation from existing investors Sequoia Capital and Andreessen Horowitz.

The funding will accelerate product development, expand the company's go-to-market operations, and support international expansion into European and Asian markets.

"This investment validates our vision of making data infrastructure accessible to every organization," said Jane Doe, CEO of Example Corp. "We will use these funds to double our engineering team and launch in three new markets by Q4 2026."

Example Corp's platform has grown 300% year-over-year, now serving over 10,000 customers across 40 countries. The company plans to reach profitability by mid-2027.

About Example Corp
Example Corp provides a unified data platform that helps organizations build, deploy, and scale data applications. Founded in 2021, the company is headquartered in San Francisco with offices in New York, London, and Singapore.

Media Contact:
press@example.com`,
    target: "press_release",
    author_name: "Rachel Adams",
    author_email: "rachel@company.com",
    status: "pending_review",
  },
  {
    title: "New Partnership with AWS Marketplace",
    body: `We're now available on AWS Marketplace. This means you can purchase and deploy our platform directly through your existing AWS account, simplifying procurement and billing.

If you're already an AWS customer, getting started takes less than 5 minutes. Check it out: aws.amazon.com/marketplace/example`,
    target: "blog",
    author_name: "Alex Rivera",
    author_email: "alex@company.com",
    status: "revision_requested",
  },
  {
    title: "Year in Review: 2025 Highlights",
    body: `As we look back on 2025, here are the moments that defined our year:

We grew from 5,000 to 10,000 customers. We launched 47 new features. We expanded to 12 new countries. And we welcomed 200 new team members.

But the numbers only tell part of the story. What we're most proud of is the community we've built. Over 15,000 developers attended our annual conference. Our open-source projects received 50,000 GitHub stars. And our community forum now has 100,000 active members.

Thank you for being part of this journey. We can't wait to show you what's coming in 2026.`,
    target: "blog",
    author_name: "Priya Sharma",
    author_email: "priya@company.com",
    status: "approved",
  },
];

const REVIEWS = [
  {
    submission_title: "Q2 Product Update: What's New",
    reviewer_name: "Content Lead",
    reviewer_email: "moderator@company.com",
    decision: "approved",
    feedback:
      "Well-written, follows brand voice guidelines. Good use of data to support claims. Approved for publication.",
  },
  {
    submission_title: "Lessons from scaling to 1M requests/sec",
    reviewer_name: "Social Lead",
    reviewer_email: "social@company.com",
    decision: "approved",
    feedback:
      "Great technical content, appropriate length and hashtag usage for LinkedIn. Approved.",
  },
  {
    submission_title: "New integration with Salesforce",
    reviewer_name: "Social Lead",
    reviewer_email: "social@company.com",
    decision: "approved",
    feedback: "Concise and clear. Good CTA with direct link.",
  },
  {
    submission_title: "New Partnership with AWS Marketplace",
    reviewer_name: "Content Lead",
    reviewer_email: "moderator@company.com",
    decision: "revision_requested",
    feedback:
      "Too short for a blog post. Needs more detail: explain the benefits for different customer segments, include setup instructions or link to docs, add a quote from leadership.",
  },
  {
    submission_title: "Year in Review: 2025 Highlights",
    reviewer_name: "Content Lead",
    reviewer_email: "moderator@company.com",
    decision: "approved",
    feedback:
      "Good retrospective. All claims are verifiable internal metrics. Approved.",
  },
];

async function createTables() {
  await query(`CREATE SCHEMA IF NOT EXISTS content_moderation`);
  await query(`
    CREATE TABLE IF NOT EXISTS content_moderation.guidelines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      target TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      rules TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS content_moderation.submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS content_moderation.ai_analyses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id UUID NOT NULL,
      compliance_score INTEGER NOT NULL,
      issues TEXT,
      suggestions TEXT,
      guidelines_snapshot TEXT,
      model TEXT NOT NULL,
      analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS content_moderation.reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      submission_id UUID NOT NULL,
      reviewer_name TEXT NOT NULL,
      reviewer_email TEXT NOT NULL,
      decision TEXT NOT NULL,
      feedback TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("Tables created.");
}

async function seedGuidelines() {
  for (const g of GUIDELINES) {
    await query(
      `INSERT INTO content_moderation.guidelines
        (target, title, description, rules, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [g.target, g.title, g.description, g.rules, g.created_by],
    );
  }
  console.log(`Seeded ${GUIDELINES.length} guidelines.`);
}

async function seedSubmissions() {
  for (const s of SUBMISSIONS) {
    await query(
      `INSERT INTO content_moderation.submissions
        (title, body, target, author_name, author_email, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.title, s.body, s.target, s.author_name, s.author_email, s.status],
    );
  }
  console.log(`Seeded ${SUBMISSIONS.length} submissions.`);
}

async function seedReviews() {
  for (const r of REVIEWS) {
    const subResult = await query(
      `SELECT id FROM content_moderation.submissions WHERE title = $1 LIMIT 1`,
      [r.submission_title],
    );
    if (subResult.rows.length === 0) {
      console.warn(`Submission not found for review: ${r.submission_title}`);
      continue;
    }
    await query(
      `INSERT INTO content_moderation.reviews
        (submission_id, reviewer_name, reviewer_email, decision, feedback)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        subResult.rows[0].id,
        r.reviewer_name,
        r.reviewer_email,
        r.decision,
        r.feedback,
      ],
    );
  }
  console.log(`Seeded ${REVIEWS.length} reviews.`);
}

async function main() {
  await client.connect();
  console.log("Connected to Lakebase.");

  await createTables();
  await seedGuidelines();
  await seedSubmissions();
  await seedReviews();

  await client.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
