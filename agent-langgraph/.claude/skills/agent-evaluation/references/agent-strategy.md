# Agent Strategy

Workflow to extract relevant information regarding the agent 

---

## Agent Understanding and Alignment (ALWAYS START HERE)

**Starting Point**: You need to evaluate an agent
**Goal**: Align on what to evaluate before writing any code

**PRIORITY:** Before writing evaluation code, complete strategy alignment. This ensures evaluations measure what matters and provide actionable insights.

### Check if `agent_server/evaluation/reports/agent_strategy.md` file exists

- If it doesn't exist ask the user if he would like to create one.
**Options:**
1. **Yes**: Proceed with Steps 1 to Step 4, complete Strategy Alignment Checklist, and save information
2. **No**: Skip everything, but warn the user this is not recommended.

- If it exits, ask user whether he would like to modify, or use existing one
**Options:**
2. **Modify** - Proceed by asking which Step and preceed accordingly
3. **Use Current** - Skip everything and use current `agent_server/evaluation/reports/agent_strategy.md` file

## Discovering Agent Server Structure

- Read all the files within the agent's server folder `agent_server` 
- Review the configuration files for system prompts and tool definitions
- Check existing tests or evaluation scripts
- Look at CLAUDE.md, AGENTS.md, and README for project context

**Each project has unique structure.** Use dynamic exploration instead of assumptions:

### Find Agent Entry Points
```bash
# Search for main agent functions
grep -r "def.*agent" . --include="*.py"
grep -r "def (run|stream|handle|process)" . --include="*.py"

# Check common locations
ls main.py app.py src/*/agent.py 2>/dev/null

# Look for API routes
grep -r "@app\.(get|post)" . --include="*.py"  # FastAPI/Flask
grep -r "def.*route" . --include="*.py"
```

### Find Tracing Integration
```bash
# Find autolog calls
grep -r "mlflow.*autolog" . --include="*.py"

# Find trace decorators
grep -r "@mlflow.trace" . --include="*.py"

# Check imports
grep -r "import mlflow" . --include="*.py"
```

### Understand Project Structure
```bash
# Check entry points in package config
cat pyproject.toml setup.py 2>/dev/null | grep -A 5 "scripts\|entry_points"

# Read project documentation
cat README.md docs/*.md 2>/dev/null | head -100

# Explore main directories
ls -la src/ app/ agent/ 2>/dev/null
```

**IMPORTANT: Always let the user know the server structure has been evaluated**

### Further Understand the Agent Context

Before evaluating, gather context about what you're evaluating:

**Questions to ask (or investigate in the codebase):**
1. **What does this agent do?** (data analysis, RAG, multi-turn chat, task automation)
2. **What tools does it use?** (UC functions, vector search, external APIs)
3. **What is the input/output format?** (messages format, structured output)
4. **What is the current state?** (prototype, production, needs improvement)

### Align on What to Evaluate & Define Quality Scorers

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

1. **Discover built-in scorers using documentation protocol:**
   - Query `https://mlflow.org/docs/latest/llms.txt` for "What built-in LLM judges or scorers are available?"
   - Read scorer documentation to understand their purpose and requirements
   - Note: Do NOT use `mlflow scorers list -b` - use documentation instead for accurate information
2. **Check registered scorers in your experiment:**
   ```bash
   uv run mlflow scorers list -x $MLFLOW_EXPERIMENT_ID
   ```
3. Identify quality dimensions for the agent and select appropriate scorers
**Questions to ask the user:**
- What are the **must-have** quality criteria? 
- What are the **nice-to-have** criteria? 
- Are there **specific failure modes** you've seen or worry about?
4. Register scorers and test on sample trace before full evaluation
5. Provide table with Scorer, Purpose, and Selection Reason

### Define User Scenarios 

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

### Establish Success Criteria

**Define quality gates for evaluation:**

Based on Chosen evaluation dimensions.

Example:
```
"safety": 1.0,           # 100% - non-negotiable
"correctness": 0.9,      # 90% - high bar for accuracy
"relevance": 0.85,       # 85% - good relevance
"concise": 0.8,          # 80% - nice to have
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

**Finish by creating a document under `agent_server/evaluation/reports/agent_strategy.md` with all pertinent responses for all Steps. This will be used for reference.** 
