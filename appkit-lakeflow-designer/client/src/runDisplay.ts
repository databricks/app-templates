import type {
  GuardrailDiagnostic,
  AppManifestBlock,
  AppMarkdownBlock,
  AppOutputBlock,
  LastRunSummary,
  RunHistoryEntry,
  MatchedOutput,
  RunOutcome,
  RunSnapshot,
} from '../../server/plugins/designer/client';
import type { LastRunState } from './lastRun';
import type { SelectedRunState } from './runHistory';
import type { RunState } from './useDesignerRun';
import type { FollowedRunState } from './useFollowedRun';

export type UnmatchedOutputState = 'beforeRun' | 'running' | 'omitted' | 'loading';

export interface RunDisplayPlan {
  displayedRun?: RunHistoryEntry;
  outputs: MatchedOutput[];
  diagnostics?: GuardrailDiagnostic[];
  unmatchedState: UnmatchedOutputState;
  showPreviousRunLabel?: boolean;
}

type PublishedBlockMatch =
  | { key: string; kind: 'markdown'; block: AppMarkdownBlock }
  | { key: string; kind: 'output'; block: AppOutputBlock; output?: MatchedOutput };

export function matchPublishedBlocks(blocks: AppManifestBlock[], outputs: MatchedOutput[]): PublishedBlockMatch[] {
  const outputsById = new Map<string, MatchedOutput>();
  for (const output of outputs) {
    if (output.id !== undefined && !outputsById.has(output.id)) {
      outputsById.set(output.id, output);
    }
  }
  return blocks.map((block, index) =>
    block.type === 'markdown'
      ? { key: `markdown:${block.id ?? index}:${index}`, kind: 'markdown', block }
      : { key: `output:${block.id}:${index}`, kind: 'output', block, output: outputsById.get(block.id) }
  );
}

function outputsFrom(result: RunOutcome | undefined): MatchedOutput[] {
  return result?.outcome === 'outputs' ? result.outputs : [];
}

export function hasWrittenFiles(result: RunOutcome | undefined): boolean {
  return outputsFrom(result).some((output) => (output.files?.length ?? 0) > 0);
}

function runHistoryEntry(
  run: LastRunSummary,
  parameters?: Record<string, string>,
  parameterDisplayValues?: Record<string, string>,
  resultState?: string,
  lifeCycleState?: string
): RunHistoryEntry {
  return {
    ...run,
    ...(parameters === undefined ? {} : { parameters }),
    ...(parameterDisplayValues === undefined ? {} : { parameterDisplayValues }),
    ...(resultState === undefined ? {} : { resultState }),
    ...(lifeCycleState === undefined ? {} : { lifeCycleState }),
  };
}

export function lastSuccessfulRunEntry(lastRun: LastRunState): RunHistoryEntry | undefined {
  return lastRun.status === 'found'
    ? runHistoryEntry(lastRun.run, lastRun.parameters, lastRun.parameterDisplayValues, lastRun.run.resultState)
    : undefined;
}

export function planRunDisplay(
  state: RunState,
  followed: FollowedRunState,
  lastRun: LastRunState,
  selectedEntry?: RunHistoryEntry,
  selectedRun?: SelectedRunState,
  retainedDisplay?: RunDisplayPlan
): RunDisplayPlan {
  if (selectedEntry !== undefined) {
    // Explicit history selection always wins, including while its result is loading or unavailable.
    return {
      displayedRun: selectedEntry,
      outputs: selectedRun?.status === 'found' ? outputsFrom(selectedRun.outcome) : [],
      diagnostics: selectedRun?.status === 'found' ? selectedRun.outcome?.diagnostics : undefined,
      unmatchedState: selectedRun?.status === 'found' || selectedRun?.status === 'unavailable' ? 'omitted' : 'loading',
    };
  }
  const lastSuccessful = lastSuccessfulRunEntry(lastRun);
  if (
    retainedDisplay?.unmatchedState === 'omitted' &&
    (state.phase === 'running' ||
      (state.phase === 'settled' && state.snapshot === undefined && state.requestError !== undefined))
  ) {
    return { ...retainedDisplay, showPreviousRunLabel: true };
  }
  if (state.phase === 'running') {
    if (lastRun.status === 'found') {
      return {
        displayedRun: lastSuccessful,
        outputs: outputsFrom(lastRun.result),
        diagnostics: lastRun.result.diagnostics,
        unmatchedState: 'omitted',
        showPreviousRunLabel: true,
      };
    }
    return { displayedRun: lastSuccessful, outputs: [], unmatchedState: 'running' };
  }
  if (state.phase === 'settled' && state.snapshot !== undefined) {
    return {
      displayedRun: runHistoryEntryFromSnapshot(state.snapshot, state.startedAt, state.params),
      outputs: outputsFrom(state.snapshot.result),
      diagnostics: state.snapshot.result?.diagnostics,
      unmatchedState: 'omitted',
    };
  }
  if (followed.following && followed.settled && followed.active !== undefined) {
    return {
      displayedRun: runHistoryEntry(
        followed.active.run,
        followed.active.parameters,
        followed.active.parameterDisplayValues,
        followed.snapshot?.resultState,
        followed.snapshot?.lifeCycleState
      ),
      outputs: outputsFrom(followed.outcome),
      diagnostics: followed.outcome?.diagnostics,
      unmatchedState: 'omitted',
    };
  }
  if (lastRun.status === 'found') {
    return {
      displayedRun: lastSuccessful,
      outputs: outputsFrom(lastRun.result),
      diagnostics: lastRun.result.diagnostics,
      unmatchedState: 'omitted',
    };
  }
  return { outputs: [], unmatchedState: followed.following ? 'running' : 'beforeRun' };
}

export function runHistoryEntryFromSnapshot(
  snapshot: RunSnapshot,
  startedAt: number | undefined,
  submittedParameters?: Record<string, string>
): RunHistoryEntry {
  const parameters = snapshot.parameters ?? submittedParameters;
  return {
    jobRunId: snapshot.jobRunId,
    ...(startedAt === undefined ? {} : { startTime: startedAt }),
    ...(snapshot.setupDurationMs === undefined ? {} : { setupDurationMs: snapshot.setupDurationMs }),
    ...(snapshot.executionDurationMs === undefined ? {} : { executionDurationMs: snapshot.executionDurationMs }),
    ...(snapshot.runPageUrl === undefined ? {} : { runPageUrl: snapshot.runPageUrl }),
    ...(snapshot.resultState === undefined ? {} : { resultState: snapshot.resultState }),
    ...(snapshot.lifeCycleState === undefined ? {} : { lifeCycleState: snapshot.lifeCycleState }),
    ...(parameters === undefined ? {} : { parameters }),
    ...(snapshot.parameterDisplayValues === undefined
      ? {}
      : { parameterDisplayValues: snapshot.parameterDisplayValues }),
  };
}
