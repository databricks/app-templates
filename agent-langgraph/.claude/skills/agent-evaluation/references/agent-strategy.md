# Agent Strategy

Workflow to extract relevant information regarding the agent 

---

## Agent Understanding and Alignment (ALWAYS START HERE)

**Starting Point**: You need to evaluate an agent
**Goal**: Align on what to evaluate before writing any code

**PRIORITY:** Before writing evaluation code, complete strategy alignment. This ensures evaluations measure what matters and provide actionable insights.

### Step 0: Check if `agent_server/evaluation/agent_strategy.md` file exists

- If it doesn't exist ask the user if he would like to create one.
**Options:**
1. **Yes**: Proceed with Steps 1 to Step 4, complete Strategy Alignment Checklist, and save information
2. **No**: Skip everything, but warn the user this is not recommended.

- If it exits, ask user whether he would like to modify, or use existing one
**Options:**
2. **Modify** - Proceed by asking which Step and preceed accordingly
3. **Use Current** - Skip everything and use current `agent_server/evaluation/agent_strategy.md` file

### Step 1: Understand the Agent

Before evaluating, gather context about what you're evaluating:

**Questions to ask (or investigate in the codebase):**
1. **What does this agent do?** (data analysis, RAG, multi-turn chat, task automation)
2. **What tools does it use?** (UC functions, vector search, external APIs)
3. **What is the input/output format?** (messages format, structured output)
4. **What is the current state?** (prototype, production, needs improvement)

**Actions to take:**
- Read all the files within the agent's server folder `agent_server` 
- Review the configuration files for system prompts and tool definitions
- Check existing tests or evaluation scripts
- Look at CLAUDE.md, AGENTS.md, and README for project context

### Step 2: Align on What to Evaluate

**Evaluation dimensions to consider:**

- **Correctness**: Factually accurate responses
- **Relevance**: Responses address the user's query
- **Safety**: Avoiding harmful or toxic content
- **Groundedness**: Responses grounded in retrieved context (for RAG agents)
- **Tool Usage**: Correct and efficient tool calls
- **Completeness**: Addressing all parts of user requests
- **Fluency**: Natural, grammatically correct responses
- **Equivalence**: Response equivalent to expectations
- **Sufficiency**: Retrieved documents contain all necessary information (for RAG agents)
- **Guidelines and Expectations Adherence**: Following specific business rules
- **Other**: Custom dimensionality to consider

**Questions to ask the user:**
1. What are the **must-have** quality criteria? (safety, accuracy, relevance)
2. What are the **nice-to-have** criteria? (conciseness, tone, format)
3. Are there **specific failure modes** you've seen or worry about?

## Step 3: Synthetic Ground Truth Dataset Decision

Ask the user:

"Would you like to create a synthetic ground truth dataset for evaluation?

**Benefits of a ground truth dataset:**
- Enables **Correctness** scoring (comparing against expected answers)
- Enables **RetrievalSufficiency** scoring (for RAG agents)
- Enables **Guidelines** and **ExpectationsGuidelines** scoring (adherence to guidelines and expectations)
- Enables **Equivalence** scoring (reponse agrees with predicted response)
- Provides consistent, repeatable evaluation baselines
- Allows tracking improvement over time

**Options:**
1. **Yes** - I'll guide you through creating a synthetic dataset relevant to your use case
2. **No** - Proceed with scorers that don't require ground truth"

### Step 3: Define User Scenarios (Evaluation Dataset)

**Types of test cases to include:**

| Category | Purpose | Example |
|----------|---------|---------|
| **Happy Path** | Core functionality works | Typical user questions |
| **Edge Cases** | Boundary conditions | Empty inputs, very long queries |
| **Adversarial** | Robustness testing | Prompt injection, off-topic |
| **Multi-turn** | Conversation handling | Follow-up questions, context recall |
| **Domain-specific** | Business logic | Industry terminology, specific formats |

**Questions to ask the user:**
1. What are the **most common** questions users ask?
2. What are **challenging** questions the agent should handle?
3. Are there questions it should **refuse** to answer?
4. Do you have **existing test cases** or production traces to start from?

### Step 4: Establish Success Criteria

**Define quality gates before running evaluation:**

```python
QUALITY_GATES = {
    "safety": 1.0,           # 100% - non-negotiable
    "correctness": 0.9,      # 90% - high bar for accuracy
    "relevance": 0.85,       # 85% - good relevance
    "concise": 0.8,          # 80% - nice to have
}
```

**Questions to ask the user:**
1. What pass rates are **acceptable** for each dimension?
2. Which metrics are **blocking** vs **informational**?
3. How will evaluation results **inform decisions**? (ship/no-ship, iterate, investigate)

### Strategy Alignment Checklist

Before implementing evaluation, confirm:
- [ ] Agent purpose and architecture understood
- [ ] Evaluation dimensions agreed upon
- [ ] Test case categories identified
- [ ] Success criteria defined

**Finish by creating a document under `agent_server/evaluation/agent_strategy.md` with all pertinent responses for all Steps. This will be used for reference.** 
