import { type DataMessagePartComponent, makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import { useId } from "react";
import { ComparisonCard } from "@/components/assistant-ui/elements/comparison-card";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/assistant-ui/elements/data-table";
import { NumberTicker } from "@/components/assistant-ui/elements/number-ticker";
import { OptionList, type OptionListOption } from "@/components/assistant-ui/elements/option-list";
import { QuestionFlow } from "@/components/assistant-ui/elements/question-flow";
import { RecommendationCard } from "@/components/assistant-ui/elements/recommendation-card";
import { ResearchReport } from "@/components/assistant-ui/elements/research-report";
import { SpecSheet } from "@/components/assistant-ui/elements/spec-sheet";
import { TodoList, type TodoItem } from "@/components/assistant-ui/elements/todo-list";
import { useChat } from "../chat-context";

const ACCEPT = "Yes, go ahead.";
const ALTERNATIVES = "Show me something else.";
const WRAP = "my-2 max-w-none [&_.truncate]:whitespace-normal";
const NUMERIC_FORMATS = new Set(["number", "currency", "percent", "delta"]);
const DECIMAL = /^-?\d+(\.\d+)?$/;

type Question = { id: string; question: string; options: OptionListOption[]; multiple: boolean };

/** Decimals arrive as strings, as the warehouse returns them; numeric columns need numbers to format and sort. */
function numericRows(columns: readonly DataTableColumn[], rows: readonly DataTableRow[]): DataTableRow[] {
  const numeric = columns.filter((column) => column.format && NUMERIC_FORMATS.has(column.format.kind));
  return rows.map((row) => {
    const next: Record<string, DataTableRow[string]> = { ...row };
    for (const { key } of numeric) {
      const value = row[key];
      if (typeof value === "string" && DECIMAL.test(value)) next[key] = Number(value);
    }
    return next;
  });
}

/** The text of the message after this one, or undefined while this one is the last. */
function useNextText(): string | undefined {
  return useAuiState((state) => {
    const messages = state.thread.messages;
    const next = messages[state.message.index + 1];
    return next?.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  });
}

function labelsOf(question: Question, ids: readonly string[]): string {
  return question.options
    .filter((option) => ids.includes(option.id))
    .map((option) => option.label)
    .join(", ");
}

const TableView: DataMessagePartComponent = ({ data }) => (
  <DataTable className="my-2" caption={data.title} columns={data.columns} rows={numericRows(data.columns, data.rows)} locale="en-GB" />
);

const NumberView: DataMessagePartComponent = ({ data }) => (
  <NumberTicker className="my-2 items-start" value={data.value} label={data.label} />
);

const DetailsView: DataMessagePartComponent = ({ data }) => (
  <SpecSheet className="my-2" title={data.title} subtitle={data.subtitle} rows={data.rows} visibleCount={data.rows.length} />
);

/**
 * Questions with answers to pick; the pick goes as the user's next message.
 * Once answered, during a run, or when reopened, the answers only show.
 */
const QuestionsView: DataMessagePartComponent = ({ data }) => {
  const { chat } = useChat();
  const canAnswer = useNextText() === undefined && !chat.isRunning;
  const questionId = useId();
  const questions = data.questions as Question[];
  if (questions.length === 1) {
    const [question] = questions;
    return (
      <div className="my-2 flex flex-col gap-2">
        <p id={questionId} className="text-sm font-medium">
          {question.question}
        </p>
        <OptionList
          aria-labelledby={questionId}
          options={question.options}
          selectionMode={question.multiple ? "multiple" : "single"}
          onConfirm={canAnswer ? (ids) => void chat.send(labelsOf(question, ids)) : undefined}
        />
      </div>
    );
  }
  const steps = questions.map((question) => ({ ...question, selectionMode: question.multiple ? "multiple" : "single" }) as const);
  const answer = (answers: Record<string, string[]>) =>
    questions.map((question) => `${question.question} ${labelsOf(question, answers[question.id] ?? [])}`).join("\n");
  return <QuestionFlow className="my-2" steps={steps} onComplete={canAnswer ? (answers) => void chat.send(answer(answers)) : undefined} />;
};

/** A suggestion that changes nothing. Accept, or asking for something else, goes as the user's next message. */
const SuggestionView: DataMessagePartComponent = ({ data }) => {
  const { chat } = useChat();
  const next = useNextText();
  return (
    <fieldset disabled={chat.isRunning} className="min-w-0 [&_button:disabled]:opacity-50">
      <RecommendationCard
        className="my-2"
        state={next === undefined ? "idle" : "accepted"}
        question={data.question}
        acceptedLabel={next === ACCEPT ? "Accepted" : "Answered below"}
        onAccept={() => void chat.send(ACCEPT)}
        onAlternatives={() => void chat.send(ALTERNATIVES)}
      >
        {data.reason}
      </RecommendationCard>
    </fieldset>
  );
};

const ComparisonView: DataMessagePartComponent = ({ data }) => (
  <ComparisonCard className={WRAP} traitLabels={data.traitLabels} options={data.options} recommendedId={data.recommendedId} reason={data.reason} />
);

/** The plan in its latest call, shown in place of the first: the model rewrites it as it works. */
const PlanView: DataMessagePartComponent = ({ id }) => {
  const latest = useAuiState((state) => {
    const plans = state.message.content.filter((part) => part.type === "data" && part.name === "plan");
    const last = plans.at(-1);
    return plans[0]?.type === "data" && plans[0].id === id && last?.type === "data" ? last.data : undefined;
  }) as { title: string; items: TodoItem[] } | undefined;
  if (!latest) return null;
  return <TodoList className="my-2 max-w-none" title={latest.title} items={latest.items} />;
};

const ReportView: DataMessagePartComponent = ({ data }) => (
  <ResearchReport
    className={WRAP}
    title={data.title}
    sourcesRead={data.sourcesRead}
    sections={data.sections.map((section: { id: string; heading: string; summary: string; sources: string[] }) => ({
      id: section.id,
      heading: section.heading,
      preview: section.summary,
      sources: section.sources.length,
      state: "done" as const,
    }))}
  />
);

/** The element each display view renders, by the view name `app/agent/tools/display.py` sends. */
const VIEWS: Record<string, DataMessagePartComponent> = {
  table: TableView,
  number: NumberView,
  details: DetailsView,
  questions: QuestionsView,
  suggestion: SuggestionView,
  comparison: ComparisonView,
  plan: PlanView,
  report: ReportView,
};

const RENDERERS = Object.entries(VIEWS).map(([name, render]) => makeAssistantDataUI({ name, render }));

/**
 * Register a renderer for each display view. A display is a data part named
 * after its view; a view without a renderer shows nothing.
 */
export function Displays() {
  return (
    <>
      {RENDERERS.map((Renderer, index) => (
        <Renderer key={index} />
      ))}
    </>
  );
}
