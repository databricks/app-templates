# Databricks notebook source

# COMMAND ----------

import json
from datetime import datetime

import mlflow.deployments
from delta.tables import DeltaTable
from pyspark.sql.types import (
    BinaryType,
    IntegerType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

# COMMAND ----------

catalog = dbutils.widgets.get("catalog")
endpoint = dbutils.widgets.get("endpoint")

client = mlflow.deployments.get_deploy_client("databricks")

# COMMAND ----------

SYSTEM_PROMPT = """You are a support agent for a SaaS platform.

Your job is to analyze a customer support case and generate:
1. A concise summary of the case so far
2. A suggested response to send to the customer
3. A recommended action (refund, credit, no_action, escalate, or resolve)
4. If refund or credit, a suggested amount in cents
5. Your reasoning for the recommendation

The prompt includes the customer's recent orders with totals. Use these to calculate appropriate amounts.

Compensation guidelines:
- Service outage (first time): credit of 15-25% of the most recent order total
- Service outage (repeat): credit of 30-50% of the most recent order total
- Billing error: refund of 30-60% of the order total (estimate based on severity)
- Wrong plan or feature issue: full refund of the most recent order total
- Performance degradation: credit of 20-40% of the most recent order total
- Complete service failure: full refund of the most recent order total
- For repeat complaints (3+ cases in 90 days): consider escalation
- High-value customers (lifetime spend > $200): lean toward the generous end of ranges
- Never suggest refund/credit exceeding the most recent order total
- If the case is already resolved with a refund/credit, suggest no_action
- ALWAYS provide a non-zero suggested_amount_cents when recommending refund or credit

Case resolution:
- If the customer's latest message is a positive acknowledgment (e.g. "thank you", "that works", "appreciate it") and the issue has already been addressed with a response, refund, or credit, recommend "resolve" with a brief friendly closing message (e.g. "Glad we could help! Closing this case."). Do not suggest additional compensation.
- If the customer is still unhappy after an admin response, draft a new response addressing their remaining concerns. Do not recommend resolve.

General principles:
- Be empathetic and professional
- Credits are goodwill gestures, refunds are for clear service failures
- When in doubt between refund and credit, prefer credit (lower cost to business)

Respond with valid JSON only, no markdown formatting:
{
  "case_summary": "...",
  "suggested_response": "...",
  "suggested_action": "refund|credit|no_action|escalate|resolve",
  "suggested_amount_cents": 0,
  "reasoning": "..."
}"""

# COMMAND ----------

unanswered_messages = spark.sql(f"""
    WITH ranked AS (
        SELECT sm.id AS message_id, sm.case_id, HEX(sm.case_id) AS case_id_hex,
               sc.user_id, sc.subject, sc.status,
               ROW_NUMBER() OVER (PARTITION BY sm.case_id ORDER BY sm.created_at DESC) AS rn
        FROM `{catalog}`.silver.support_messages sm
        JOIN `{catalog}`.silver.support_cases sc ON sm.case_id = sc.id
        LEFT JOIN `{catalog}`.gold.support_agent_responses ar ON sm.id = ar.message_id
        WHERE sc.status IN ('open', 'in_progress')
          AND sm.admin_id IS NULL
          AND ar.message_id IS NULL
    )
    SELECT message_id, case_id, case_id_hex, user_id, subject, status
    FROM ranked
    WHERE rn = 1
""").collect()

print(f"Found {len(unanswered_messages)} unanswered user messages to process")

# COMMAND ----------


def build_prompt(case_row):
    case_id_hex = case_row["case_id_hex"]
    user_id = case_row["user_id"]

    context_df = spark.sql(f"""
        SELECT user_name, user_email, user_region, subject, status,
               message_count, has_admin_reply, first_response_minutes,
               linked_refund_cents, linked_credit_cents,
               user_lifetime_spend_cents, user_cases_90d
        FROM `{catalog}`.gold.support_case_context
        WHERE case_id = UNHEX('{case_id_hex}')
    """).collect()

    profile_df = spark.sql(f"""
        SELECT total_orders_90d, total_spend_90d_cents,
               lifetime_order_count, lifetime_spend_cents,
               support_cases_90d, total_refunds_90d_cents, total_credits_90d_cents
        FROM `{catalog}`.gold.user_support_profile
        WHERE user_id = '{user_id}'
    """).collect()

    messages_df = spark.sql(f"""
        SELECT
            CASE WHEN admin_id IS NOT NULL THEN 'admin' ELSE 'customer' END AS role,
            content,
            created_at
        FROM `{catalog}`.silver.support_messages
        WHERE case_id = UNHEX('{case_id_hex}')
        ORDER BY created_at ASC
    """).collect()

    orders_df = spark.sql(f"""
        SELECT HEX(id) AS order_id, status, total_in_cents, created_at
        FROM `{catalog}`.silver.orders
        WHERE user_id = '{user_id}'
        ORDER BY created_at DESC
        LIMIT 5
    """).collect()

    ctx = context_df[0] if context_df else None
    profile = profile_df[0] if profile_df else None

    parts = []
    parts.append(f"Subject: {case_row['subject']}")
    parts.append(f"Status: {case_row['status']}")

    if ctx:
        parts.append(f"Customer: {ctx['user_name']} ({ctx['user_email']}), region: {ctx['user_region']}")
        parts.append(f"Messages so far: {ctx['message_count']}")
        parts.append(f"Admin has replied: {ctx['has_admin_reply']}")
        if ctx["first_response_minutes"] is not None:
            parts.append(f"First response time: {ctx['first_response_minutes']} minutes")
        parts.append(f"Linked refunds: ${ctx['linked_refund_cents'] / 100:.2f}")
        parts.append(f"Linked credits: ${ctx['linked_credit_cents'] / 100:.2f}")

    if profile:
        parts.append(f"\nCustomer Profile:")
        parts.append(f"  Lifetime orders: {profile['lifetime_order_count']}, spend: ${profile['lifetime_spend_cents'] / 100:.2f}")
        parts.append(f"  Last 90 days: {profile['total_orders_90d']} orders, ${profile['total_spend_90d_cents'] / 100:.2f} spent")
        parts.append(f"  Support cases (90d): {profile['support_cases_90d']}")
        parts.append(f"  Refunds (90d): ${profile['total_refunds_90d_cents'] / 100:.2f}")
        parts.append(f"  Credits (90d): ${profile['total_credits_90d_cents'] / 100:.2f}")

    if orders_df:
        parts.append(f"\nRecent Orders (newest first):")
        for order in orders_df:
            ts = order["created_at"].strftime("%Y-%m-%d %H:%M") if order["created_at"] else ""
            parts.append(f"  [{ts}] ${order['total_in_cents'] / 100:.2f} — {order['status']}")
        most_recent = orders_df[0]
        parts.append(f"  Most recent order total: ${most_recent['total_in_cents'] / 100:.2f}")
    else:
        parts.append(f"\nNo recent orders found.")

    parts.append(f"\nMessage Thread:")
    for msg in messages_df:
        ts = msg["created_at"].strftime("%H:%M") if msg["created_at"] else ""
        parts.append(f"  [{ts}] {msg['role'].upper()}: {msg['content']}")

    return "\n".join(parts)

# COMMAND ----------


def call_llm(prompt):
    response = client.predict(
        endpoint=endpoint,
        inputs={
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 1000,
            "temperature": 0.3,
        },
    )
    content = response["choices"][0]["message"]["content"]
    model_name = response.get("model", endpoint)
    return content, model_name

# COMMAND ----------


def parse_response(raw_content):
    cleaned = raw_content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    parsed = json.loads(cleaned)

    valid_actions = {"refund", "credit", "no_action", "escalate", "resolve"}
    action = parsed.get("suggested_action", "no_action")
    if action not in valid_actions:
        action = "no_action"

    return {
        "case_summary": str(parsed.get("case_summary", "")),
        "suggested_response": str(parsed.get("suggested_response", "")),
        "suggested_action": action,
        "suggested_amount_cents": int(parsed.get("suggested_amount_cents", 0)),
        "reasoning": str(parsed.get("reasoning", "")),
    }

# COMMAND ----------

results = []
now = datetime.utcnow()

for msg in unanswered_messages:
    try:
        prompt = build_prompt(msg)
        raw_content, model_name = call_llm(prompt)
        parsed = parse_response(raw_content)

        results.append({
            "message_id": msg["message_id"],
            "case_id": msg["case_id"],
            "user_id": msg["user_id"],
            "case_summary": parsed["case_summary"],
            "suggested_response": parsed["suggested_response"],
            "suggested_action": parsed["suggested_action"],
            "suggested_amount_cents": parsed["suggested_amount_cents"],
            "reasoning": parsed["reasoning"],
            "model": model_name,
            "generated_at": now,
        })
        print(f"Processed case {msg['subject']}: {parsed['suggested_action']}")
    except Exception as e:
        print(f"Error processing case {msg['subject']}: {e}")

print(f"\nGenerated {len(results)} responses out of {len(unanswered_messages)} messages")

# COMMAND ----------

if results:
    schema = StructType([
        StructField("message_id", BinaryType(), False),
        StructField("case_id", BinaryType(), False),
        StructField("user_id", StringType(), False),
        StructField("case_summary", StringType(), False),
        StructField("suggested_response", StringType(), False),
        StructField("suggested_action", StringType(), False),
        StructField("suggested_amount_cents", IntegerType(), False),
        StructField("reasoning", StringType(), False),
        StructField("model", StringType(), False),
        StructField("generated_at", TimestampType(), False),
    ])

    df = spark.createDataFrame(results, schema=schema)
    table_name = f"`{catalog}`.gold.support_agent_responses"

    target = DeltaTable.forName(spark, table_name)
    target.alias("t").merge(
        df.alias("s"), "t.message_id = s.message_id"
    ).whenNotMatchedInsertAll().execute()

    print(f"Merged {df.count()} rows into {catalog}.gold.support_agent_responses")
else:
    print("No new messages to process")
