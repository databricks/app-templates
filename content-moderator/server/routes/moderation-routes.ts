import { z } from "zod";
import type { Application } from "express";

interface AppKitWithLakebase {
  lakebase: {
    query(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const GUIDELINES_EXISTS_SQL = `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'content_moderation' AND table_name = 'guidelines'
`;

const SETUP_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS content_moderation`;

const CREATE_GUIDELINES_TABLE_SQL = `
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
`;

const CREATE_SUBMISSIONS_TABLE_SQL = `
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
`;

const CREATE_AI_ANALYSES_TABLE_SQL = `
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
`;

const CREATE_REVIEWS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS content_moderation.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL,
    reviewer_name TEXT NOT NULL,
    reviewer_email TEXT NOT NULL,
    decision TEXT NOT NULL,
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CONTENT_TARGETS = [
  "blog",
  "linkedin",
  "twitter",
  "newsletter",
  "press_release",
] as const;

const SUBMISSION_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
  "revision_requested",
] as const;

const REVIEW_DECISIONS = [
  "approved",
  "rejected",
  "revision_requested",
] as const;

const CreateGuidelineBody = z.object({
  target: z.enum(CONTENT_TARGETS),
  title: z.string().min(1),
  description: z.string().optional(),
  rules: z.string().min(1),
  created_by: z.string().email(),
});

const UpdateGuidelineBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  rules: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
  updated_by: z.string().email(),
});

const CreateSubmissionBody = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  target: z.enum(CONTENT_TARGETS),
  author_name: z.string().min(1),
  author_email: z.string().email(),
});

const CreateReviewBody = z.object({
  reviewer_name: z.string().min(1),
  reviewer_email: z.string().email(),
  decision: z.enum(REVIEW_DECISIONS),
  feedback: z.string().optional(),
});

const SERVING_ENDPOINT = process.env.SERVING_ENDPOINT;
const DATABRICKS_HOST = process.env.DATABRICKS_HOST;

async function analyzeContent(
  appkit: AppKitWithLakebase,
  submissionId: string,
  title: string,
  body: string,
  target: string,
): Promise<void> {
  if (!SERVING_ENDPOINT) {
    console.log(
      "[moderation] No SERVING_ENDPOINT configured, skipping AI analysis",
    );
    return;
  }

  const guidelinesResult = await appkit.lakebase.query(
    `SELECT title, rules FROM content_moderation.guidelines
     WHERE target = $1 AND is_active = true
     ORDER BY created_at ASC`,
    [target],
  );

  if (guidelinesResult.rows.length === 0) {
    console.log(
      `[moderation] No active guidelines for target "${target}", skipping AI analysis`,
    );
    return;
  }

  const guidelinesText = guidelinesResult.rows
    .map((g) => `## ${g.title}\n${g.rules}`)
    .join("\n\n");

  const prompt = `You are a content moderation assistant. Analyze the following content submission against the provided guidelines.

## Content Target
${target}

## Guidelines
${guidelinesText}

## Submitted Content
Title: ${title}

${body}

## Your Task
Evaluate the content against ALL guidelines above. Respond with ONLY valid JSON (no markdown fences):

{
  "compliance_score": <0-100, where 100 is fully compliant>,
  "issues": [<array of specific guideline violations or concerns, empty if none>],
  "suggestions": "<brief actionable suggestions for improvement, or empty string if compliant>"
}`;

  try {
    const token =
      process.env.DATABRICKS_TOKEN ?? process.env.DATABRICKS_API_TOKEN;
    const host = DATABRICKS_HOST?.replace(/\/$/, "");

    if (!host || !token) {
      console.log(
        "[moderation] Missing DATABRICKS_HOST or token, skipping AI analysis",
      );
      return;
    }

    const response = await fetch(
      `${host}/serving-endpoints/${SERVING_ENDPOINT}/invocations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1024,
        }),
      },
    );

    if (!response.ok) {
      console.error(
        `[moderation] Serving endpoint returned ${response.status}`,
      );
      return;
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = result.choices?.[0]?.message?.content ?? "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[moderation] Could not parse JSON from AI response");
      return;
    }

    const analysis = JSON.parse(jsonMatch[0]) as {
      compliance_score: number;
      issues: string[];
      suggestions: string;
    };

    await appkit.lakebase.query(
      `INSERT INTO content_moderation.ai_analyses
        (submission_id, compliance_score, issues, suggestions, guidelines_snapshot, model)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [
        submissionId,
        Math.max(0, Math.min(100, analysis.compliance_score)),
        JSON.stringify(analysis.issues),
        analysis.suggestions,
        guidelinesText,
        SERVING_ENDPOINT,
      ],
    );

    console.log(
      `[moderation] AI analysis complete for submission ${submissionId}: score=${analysis.compliance_score}`,
    );
  } catch (err) {
    console.error("[moderation] AI analysis failed:", (err as Error).message);
  }
}

export async function setupModerationRoutes(appkit: AppKitWithLakebase) {
  try {
    const { rows } = await appkit.lakebase.query(GUIDELINES_EXISTS_SQL);
    if (rows.length > 0) {
      console.log("[moderation] Tables already exist");
    } else {
      await appkit.lakebase.query(SETUP_SCHEMA_SQL);
      await appkit.lakebase.query(CREATE_GUIDELINES_TABLE_SQL);
      await appkit.lakebase.query(CREATE_SUBMISSIONS_TABLE_SQL);
      await appkit.lakebase.query(CREATE_AI_ANALYSES_TABLE_SQL);
      await appkit.lakebase.query(CREATE_REVIEWS_TABLE_SQL);
      console.log("[moderation] Created schema and tables");
    }
  } catch (err) {
    console.warn("[moderation] Database setup failed:", (err as Error).message);
  }

  appkit.server.extend((app) => {
    // --- Guidelines ---

    app.get("/api/guidelines", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            id::text, target, title, description, rules,
            is_active, created_by, updated_by, created_at, updated_at
          FROM content_moderation.guidelines
          ORDER BY target ASC, created_at ASC
        `);
        res.json(result.rows);
      } catch (err) {
        console.error("Failed to list guidelines:", err);
        res.status(500).json({ error: "Failed to list guidelines" });
      }
    });

    app.get("/api/guidelines/:id", async (req, res) => {
      try {
        const result = await appkit.lakebase.query(
          `SELECT
            id::text, target, title, description, rules,
            is_active, created_by, updated_by, created_at, updated_at
          FROM content_moderation.guidelines
          WHERE id = $1::uuid`,
          [req.params.id],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Guideline not found" });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error("Failed to get guideline:", err);
        res.status(500).json({ error: "Failed to get guideline" });
      }
    });

    app.post("/api/guidelines", async (req, res) => {
      try {
        const parsed = CreateGuidelineBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }
        const d = parsed.data;
        const result = await appkit.lakebase.query(
          `INSERT INTO content_moderation.guidelines
            (target, title, description, rules, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $5)
           RETURNING id::text, target, title, created_at`,
          [d.target, d.title, d.description ?? null, d.rules, d.created_by],
        );
        res.status(201).json(result.rows[0]);
      } catch (err) {
        console.error("Failed to create guideline:", err);
        res.status(500).json({ error: "Failed to create guideline" });
      }
    });

    app.put("/api/guidelines/:id", async (req, res) => {
      try {
        const parsed = UpdateGuidelineBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }
        const d = parsed.data;
        const setClauses: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        const fields: Array<[string, unknown]> = [
          ["title", d.title],
          ["description", d.description],
          ["rules", d.rules],
          ["is_active", d.is_active],
        ];

        for (const [col, val] of fields) {
          if (val !== undefined) {
            setClauses.push(`${col} = $${paramIdx}`);
            values.push(val);
            paramIdx++;
          }
        }

        setClauses.push(`updated_by = $${paramIdx}`);
        values.push(d.updated_by);
        paramIdx++;

        setClauses.push("updated_at = NOW()");
        values.push(req.params.id);

        const result = await appkit.lakebase.query(
          `UPDATE content_moderation.guidelines
           SET ${setClauses.join(", ")}
           WHERE id = $${paramIdx}::uuid
           RETURNING id::text, target, title, is_active, updated_at`,
          values,
        );

        if (result.rows.length === 0) {
          res.status(404).json({ error: "Guideline not found" });
          return;
        }
        res.json(result.rows[0]);
      } catch (err) {
        console.error("Failed to update guideline:", err);
        res.status(500).json({ error: "Failed to update guideline" });
      }
    });

    app.delete("/api/guidelines/:id", async (req, res) => {
      try {
        const result = await appkit.lakebase.query(
          `DELETE FROM content_moderation.guidelines WHERE id = $1::uuid RETURNING id::text`,
          [req.params.id],
        );
        if (result.rows.length === 0) {
          res.status(404).json({ error: "Guideline not found" });
          return;
        }
        res.json({ deleted: true });
      } catch (err) {
        console.error("Failed to delete guideline:", err);
        res.status(500).json({ error: "Failed to delete guideline" });
      }
    });

    // --- Submissions ---

    app.get("/api/submissions", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            s.id::text, s.title, s.body, s.target,
            s.author_name, s.author_email, s.status,
            s.created_at, s.updated_at,
            a.compliance_score,
            a.issues AS ai_issues
          FROM content_moderation.submissions s
          LEFT JOIN LATERAL (
            SELECT compliance_score, issues
            FROM content_moderation.ai_analyses
            WHERE submission_id = s.id
            ORDER BY analyzed_at DESC LIMIT 1
          ) a ON true
          ORDER BY
            CASE WHEN s.status = 'pending_review' THEN 0
                 WHEN s.status = 'revision_requested' THEN 1
                 WHEN s.status = 'approved' THEN 2
                 ELSE 3
            END,
            s.created_at DESC
        `);
        res.json(result.rows);
      } catch (err) {
        console.error("Failed to list submissions:", err);
        res.status(500).json({ error: "Failed to list submissions" });
      }
    });

    app.get("/api/submissions/:id", async (req, res) => {
      try {
        const subResult = await appkit.lakebase.query(
          `SELECT
            id::text, title, body, target,
            author_name, author_email, status,
            created_at, updated_at
          FROM content_moderation.submissions
          WHERE id = $1::uuid`,
          [req.params.id],
        );

        if (subResult.rows.length === 0) {
          res.status(404).json({ error: "Submission not found" });
          return;
        }

        const analysesResult = await appkit.lakebase.query(
          `SELECT
            id::text, compliance_score, issues, suggestions,
            model, analyzed_at
          FROM content_moderation.ai_analyses
          WHERE submission_id = $1::uuid
          ORDER BY analyzed_at DESC`,
          [req.params.id],
        );

        const reviewsResult = await appkit.lakebase.query(
          `SELECT
            id::text, reviewer_name, reviewer_email,
            decision, feedback, created_at
          FROM content_moderation.reviews
          WHERE submission_id = $1::uuid
          ORDER BY created_at DESC`,
          [req.params.id],
        );

        const guidelinesResult = await appkit.lakebase.query(
          `SELECT id::text, title, rules
          FROM content_moderation.guidelines
          WHERE target = $1 AND is_active = true
          ORDER BY created_at ASC`,
          [subResult.rows[0].target as string],
        );

        res.json({
          submission: subResult.rows[0],
          analyses: analysesResult.rows,
          reviews: reviewsResult.rows,
          guidelines: guidelinesResult.rows,
        });
      } catch (err) {
        console.error("Failed to get submission:", err);
        res.status(500).json({ error: "Failed to get submission" });
      }
    });

    app.post("/api/submissions", async (req, res) => {
      try {
        const parsed = CreateSubmissionBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }
        const d = parsed.data;
        const result = await appkit.lakebase.query(
          `INSERT INTO content_moderation.submissions
            (title, body, target, author_name, author_email)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id::text, title, target, status, created_at`,
          [d.title, d.body, d.target, d.author_name, d.author_email],
        );

        const submission = result.rows[0];

        analyzeContent(
          appkit,
          submission.id as string,
          d.title,
          d.body,
          d.target,
        ).catch((err) =>
          console.error("[moderation] Background analysis failed:", err),
        );

        res.status(201).json(submission);
      } catch (err) {
        console.error("Failed to create submission:", err);
        res.status(500).json({ error: "Failed to create submission" });
      }
    });

    app.post("/api/submissions/:id/reanalyze", async (req, res) => {
      try {
        const subResult = await appkit.lakebase.query(
          `SELECT id::text, title, body, target
          FROM content_moderation.submissions WHERE id = $1::uuid`,
          [req.params.id],
        );
        if (subResult.rows.length === 0) {
          res.status(404).json({ error: "Submission not found" });
          return;
        }
        const sub = subResult.rows[0];
        analyzeContent(
          appkit,
          sub.id as string,
          sub.title as string,
          sub.body as string,
          sub.target as string,
        ).catch((err) =>
          console.error("[moderation] Re-analysis failed:", err),
        );
        res.json({ status: "analysis_started" });
      } catch (err) {
        console.error("Failed to trigger re-analysis:", err);
        res.status(500).json({ error: "Failed to trigger re-analysis" });
      }
    });

    // --- Reviews ---

    app.post("/api/submissions/:id/review", async (req, res) => {
      try {
        const parsed = CreateReviewBody.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.issues,
          });
          return;
        }
        const d = parsed.data;

        const reviewResult = await appkit.lakebase.query(
          `INSERT INTO content_moderation.reviews
            (submission_id, reviewer_name, reviewer_email, decision, feedback)
           VALUES ($1::uuid, $2, $3, $4, $5)
           RETURNING id::text, decision, created_at`,
          [
            req.params.id,
            d.reviewer_name,
            d.reviewer_email,
            d.decision,
            d.feedback ?? null,
          ],
        );

        const statusMap: Record<string, string> = {
          approved: "approved",
          rejected: "rejected",
          revision_requested: "revision_requested",
        };

        await appkit.lakebase.query(
          `UPDATE content_moderation.submissions
           SET status = $1, updated_at = NOW()
           WHERE id = $2::uuid`,
          [statusMap[d.decision], req.params.id],
        );

        res.status(201).json(reviewResult.rows[0]);
      } catch (err) {
        console.error("Failed to create review:", err);
        res.status(500).json({ error: "Failed to create review" });
      }
    });

    // --- Content Targets metadata ---

    app.get("/api/targets", async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT
            target,
            COUNT(*) FILTER (WHERE is_active) AS active_guidelines,
            COUNT(*) AS total_guidelines
          FROM content_moderation.guidelines
          GROUP BY target
          ORDER BY target
        `);

        const allTargets = CONTENT_TARGETS.map((t) => {
          const row = result.rows.find((r) => r.target === t);
          return {
            target: t,
            active_guidelines: Number(row?.active_guidelines ?? 0),
            total_guidelines: Number(row?.total_guidelines ?? 0),
          };
        });

        res.json(allTargets);
      } catch (err) {
        console.error("Failed to list targets:", err);
        res.status(500).json({ error: "Failed to list targets" });
      }
    });
  });
}
