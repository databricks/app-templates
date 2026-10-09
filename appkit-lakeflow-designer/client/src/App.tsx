import type { SetStateAction } from 'react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card } from '@databricks/appkit-ui/react';

import { ActiveRunBanner } from './ActiveRunBanner';
import type { FileOutputBehavior } from '../../shared/fileOutputs';
import type {
  AppChartSpec,
  AppManifestBlock,
  AppMarkdownBlock,
  AppOutputBlock,
  AppParameter,
} from '../../shared/appManifest';
import {
  fetchAppConfig,
  initialValuesFor,
  refreshedValuesFor,
  uploadConfigurationKey,
  type AppConfigState,
  type NotRunnableReason,
} from './appConfig';
import { UPLOAD_REFERENCE } from '../../shared/storageConfig';
import { MarkdownBlock } from './MarkdownBlock';
import { OutputFileDownloads } from './OutputFileDownloads';
import type { PublishedChartRefusal } from './chartTranslation';
import { describePublishedChartRefusal, translatePublishedChart } from './chartTranslation';
import type { LandingSection } from './landingPlan';
import { FOLLOWED_RESULT_AVAILABLE_OFFER, planLandingArea } from './landingPlan';
import type { ActiveRun, LastRunState, LastRunSummary } from './lastRun';
import { fetchLastRun } from './lastRun';
import type { LastRunVariant } from './LastRunLabel';
import { LastRunLabel, relative } from './LastRunLabel';
import { ParameterForm } from './ParameterForm';
import { LazyOutputChart, preloadOutputChart } from './renderersLazy';
import { RunHistorySelect } from './RunHistoryList';
import type { RunHistoryEntry, RunHistoryState, SelectedRunState } from './runHistory';
import {
  RUN_HISTORY_FIRST_WINDOW,
  fetchRunHistory,
  fetchRunResult,
  hasNewerUnsuccessfulRun,
  isSuccessfulResultState,
} from './runHistory';
import { ResultFooter } from './ResultFooter';
import { ResultGrid } from './ResultGrid';
import { ComputeError, EmptyResult, MalformedOutput, MissingOutput, NoPayload } from './ResultStates';
import { RunStatus } from './RunStatus';
import { ThemeToggle } from './ThemeToggle';
import type { RunState } from './useDesignerRun';
import { useDesignerRun } from './useDesignerRun';
import type { FollowedRunState } from './useFollowedRun';
import { useFollowedRun } from './useFollowedRun';
import type { MatchedOutput, OkPayload, RunOutcome, RunSnapshot } from './payload';

const EMPTY_LANDING_MESSAGES = {
  loading: 'Looking for the last run…',
  unavailable: 'The last run could not be loaded. Run the operator to compute a fresh result.',
} as const;

const NOT_RUNNABLE_MESSAGES: Record<NotRunnableReason, string> = {

  noManifest: 'This app has no published outputs, so there is nothing to run. It may need republishing.',
  noJob: 'This app is not connected to a job yet, so it cannot run. Its publisher needs to finish setting it up.',
};

type UnmatchedOutputState = 'beforeRun' | 'running' | 'omitted' | 'loading';

type PublishedBlockMatch =
  | { key: string; kind: 'markdown'; block: AppMarkdownBlock }
  | { key: string; kind: 'output'; block: AppOutputBlock; output?: MatchedOutput };

export function matchPublishedBlocks(
  blocks: AppManifestBlock[],
  outputs: MatchedOutput[],
): PublishedBlockMatch[] {
  const outputsById = new Map<string, MatchedOutput>();
  for (const output of outputs) {
    if (output.id !== undefined && !outputsById.has(output.id)) {
      outputsById.set(output.id, output);
    }
  }
  return blocks.map((block, index) =>
    block.type === 'markdown'
      ? { key: `markdown:${block.id ?? index}:${index}`, kind: 'markdown', block }
      : { key: `output:${block.id}:${index}`, kind: 'output', block, output: outputsById.get(block.id) },
  );
}

export function App() {
  const [config, setConfig] = useState<AppConfigState>({ status: 'loading' });
  const [lastRun, setLastRun] = useState<LastRunState>({ status: 'loading' });
  const [values, setValues] = useState<Record<string, string>>({});
  const [configurationMessage, setConfigurationMessage] = useState<string>();
  const [uploadReset, setUploadReset] = useState(0);
  const currentUploadReset = useRef(0);
  const currentConfig = useRef<AppConfigState>(config);
  const configRequest = useRef(0);
  const submissionPending = useRef(false);

  const formUntouched = useRef(true);
  const invalidateUploads = useCallback(() => {
    currentUploadReset.current += 1;
    setUploadReset(currentUploadReset.current);
  }, []);
  const refreshConfiguration = useCallback(async () => {
    const request = ++configRequest.current;
    const next = await fetchAppConfig();
    if (request !== configRequest.current) return false;
    const previous = currentConfig.current;
    if (next.status !== 'ready') {
      if (previous.status !== 'ready') setConfig(next);
      setConfigurationMessage('Could not refresh the app configuration. Try Run again after the app is available.');
      return false;
    }
    const changed =
      previous.status === 'ready' &&
      uploadConfigurationKey(previous.manifest) !== uploadConfigurationKey(next.manifest);
    currentConfig.current = next;
    setConfig(next);
    if (previous.status === 'ready') {
      setValues((current) => refreshedValuesFor(previous.manifest, next.manifest, current));
    }
    if (changed) {
      // Keep an observed round trip invalid even if React batches both configuration updates.
      invalidateUploads();
      setConfigurationMessage(next.manifest.parameters.some(({ type }) => type === 'file')
        ? 'The app’s storage or file inputs changed. Select your files again, then click Run.'
        : 'The app configuration changed. Review your inputs, then click Run.');
    }
    return next.runnable && !changed;
  }, [invalidateUploads]);
  const uploadUnavailable = useCallback(() => {
    invalidateUploads();
    const current = currentConfig.current;
    if (current.status === 'ready') {
      const files = new Set(current.manifest.parameters.filter(({ type }) => type === 'file').map(({ name }) => name));
      setValues((previous) =>
        Object.fromEntries(Object.entries(previous).map(([name, value]) => [name, files.has(name) ? '' : value])),
      );
    }
    setConfigurationMessage('An upload is no longer available. Select your files again, then click Run.');
    void refreshConfiguration();
  }, [invalidateUploads, refreshConfiguration]);
  const { state, start, cancel, reset } = useDesignerRun(uploadUnavailable);
  const [history, setHistory] = useState<RunHistoryState>({ status: 'loading' });

  const [selectedEntry, setSelectedEntry] = useState<RunHistoryEntry | undefined>(undefined);
  const [selectedRun, setSelectedRun] = useState<SelectedRunState | undefined>(undefined);

  const followed = useFollowedRun(activeRunOf(lastRun), state.phase);
  const ownFinishedRunId = state.phase === 'settled' ? state.snapshot?.jobRunId : undefined;
  const followedFinishedRunId = followed.settled ? followed.active?.run.jobRunId : undefined;

  useEffect(() => {
    void refreshConfiguration();
    const onFocus = () => {
      void refreshConfiguration();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      configRequest.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshConfiguration]);

  useEffect(() => {
    if (config.status === 'ready') {
      document.title = config.manifest.appName;
    }
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchLastRun();
      if (!cancelled) {
        setLastRun(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownFinishedRunId, followedFinishedRunId]);

  const historyEnabled = config.status === 'ready' && config.runnable;

  useEffect(() => {
    if (!historyEnabled) {
      return undefined;
    }
    let cancelled = false;

    setHistory((prev) => (prev.status === 'found' ? prev : { status: 'loading' }));
    void (async () => {
      const next = await fetchRunHistory(RUN_HISTORY_FIRST_WINDOW);
      if (!cancelled) {
        setHistory(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyEnabled, ownFinishedRunId, followedFinishedRunId]);

  useEffect(() => {
    const jobRunId = selectedEntry?.jobRunId;
    if (jobRunId === undefined) {
      return undefined;
    }
    let cancelled = false;
    setSelectedRun({ status: 'loading' });
    void (async () => {
      const next = await fetchRunResult(jobRunId);
      if (!cancelled) {
        setSelectedRun(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEntry?.jobRunId]);

  useEffect(() => {
    if (!formUntouched.current || config.status !== 'ready') {
      return;
    }
    setValues(initialValuesFor(config.manifest, lastRunValuesOf(lastRun)));
  }, [config, lastRun]);

  if (config.status === 'loading') {
    return (
      <Shell>
        <p className="text-muted-foreground text-sm">Loading…</p>
      </Shell>
    );
  }

  if (config.status === 'unavailable') {
    return (
      <Shell>
        <Alert variant="destructive">
          <AlertTitle>This app could not be loaded</AlertTitle>
          <AlertDescription>
            <p>Publishing may not have finished, or the app is missing its configuration ({config.detail}).</p>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const { manifest, runnable, notRunnableReason } = config;
  const outputsLabel = describeOutputs(manifest.blocks);
  const changeValues = (next: SetStateAction<Record<string, string>>) => {
    const current = currentConfig.current;
    if (
      uploadReset !== currentUploadReset.current ||
      current.status !== 'ready' ||
      uploadConfigurationKey(current.manifest) !== uploadConfigurationKey(manifest)
    ) return;
    formUntouched.current = false;
    setValues(next);
  };
  const clearSelection = () => {
    setSelectedEntry(undefined);
    setSelectedRun(undefined);
  };
  const runWithValues = async (runValues: Record<string, string>, signal?: AbortSignal) => {
    if (submissionPending.current) return;
    submissionPending.current = true;
    try {
      // Refresh again after upload: publishing can overlap a long-running file transfer.
      if (!(await refreshConfiguration()) || signal?.aborted || uploadReset !== currentUploadReset.current) return;
      const current = currentConfig.current;
      if (
        current.status !== 'ready' ||
        uploadConfigurationKey(current.manifest) !== uploadConfigurationKey(manifest)
      ) return;
      const currentValues = refreshedValuesFor(manifest, current.manifest, runValues);
      if (current.manifest.parameters.some(
        ({ name, type }) => type === 'file' && !UPLOAD_REFERENCE.test(currentValues[name] ?? ''),
      )) {
        setConfigurationMessage('Select your files again, then click Run.');
        return;
      }
      formUntouched.current = false;
      setValues(currentValues);
      clearSelection();
      setConfigurationMessage(undefined);
      if (manifest.blocks.some((block) => block.type === 'output' && block.chartSpec !== undefined)) {
        preloadOutputChart();
      }
      await start(currentValues);
    } finally {
      submissionPending.current = false;
    }
  };
  const run = () => {
    void runWithValues(values);
  };
  const selectRun = (entry: RunHistoryEntry) => {

    if (state.phase === 'settled') {
      reset();
    }
    setSelectedRun({ status: 'loading' });
    setSelectedEntry(entry);
  };

  const viewFollowedResult = () => clearSelection();
  const result = state.snapshot?.result;
  const ownRunSucceeded = state.phase === 'settled' && isSuccessfulResultState(state.snapshot?.resultState);
  const ownFinishedAt = state.startedAt === undefined ? undefined : state.startedAt + state.elapsedMs;
  const { displayedRun, outputs: displayedOutputs, unmatchedState: unmatchedOutputState } = planRunDisplay(
    state,
    followed,
    lastRun,
    selectedEntry,
    selectedRun,
  );
  const newerRunDidNotSucceed =
    selectedEntry === undefined &&
    lastRun.status === 'found' &&
    history.status === 'found' &&
    hasNewerUnsuccessfulRun(history.runs, lastRun.run.endTime);
  const historyState: RunHistoryState =
    !runnable && notRunnableReason === 'noJob' ? { status: 'noJob' } : history;

  return (
    <Shell>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{manifest.appName}</h1>
          {manifest.subtitle === undefined ? null : (
            <p className="text-muted-foreground mt-1 text-sm">{manifest.subtitle}</p>
          )}
          {}
          {manifest.provenance === undefined ? null : (
            <p
              className="text-muted-foreground mt-1 text-xs"
              title={
                manifest.provenance.generatorVersion === undefined
                  ? undefined
                  : `Generated by Designer app generator v${manifest.provenance.generatorVersion}`
              }
            >
              {`Flow published ${relative(manifest.provenance.publishedAt, Date.now())}, ${new Date(
                manifest.provenance.publishedAt,
              ).toLocaleString()}.`}
            </p>
          )}
        </div>
        <div className="flex max-w-full flex-wrap items-start justify-end gap-2">
          {runnable || notRunnableReason === 'noJob' ? (
            <RunHistorySelect state={historyState} displayedRun={displayedRun} onSelect={selectRun} />
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <div className="grid gap-6">
        <Card className="overflow-hidden p-0">
          {configurationMessage && (
            <div className="px-6 pt-6" role="status">
              <Alert>
                <AlertTitle>Check your app inputs</AlertTitle>
                <AlertDescription>{configurationMessage}</AlertDescription>
              </Alert>
            </div>
          )}
          <ParameterForm
            key={`${uploadConfigurationKey(manifest)}:${uploadReset}`}
            parameters={manifest.parameters}
            values={values}
            onChange={changeValues}
            onRun={runWithValues}
            onPrepareRun={async () => (await refreshConfiguration()) && uploadReset === currentUploadReset.current}
            onUploadUnavailable={uploadUnavailable}
            running={state.phase === 'running'}
            runnable={runnable}
          />

          {
}
          {!runnable && notRunnableReason !== undefined ? (
            <div className="border-border border-t px-6 py-4">
              <Alert>
                <AlertTitle>Not ready to run</AlertTitle>
                <AlertDescription>{NOT_RUNNABLE_MESSAGES[notRunnableReason]}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          {

}
          {state.phase === 'idle' || (state.phase === 'settled' && state.snapshot === undefined)
            ? planLandingArea({
                lastRun: lastRun.status,
                following: followed.following,
                followedSettled: followed.settled,
                selectedRun: selectedEntry !== undefined,
              }).map((section) => (
                <LandingBlock
                  key={section.kind === 'lastRun' ? `lastRun-${section.superseded}` : section.kind}
                  section={section}
                  lastRun={lastRun}
                  followedActive={followed.active}
                  followedOutcome={followed.outcome}
                  followedSnapshot={followed.snapshot}
                  followedFinishedAt={followed.finishedAt}
                  selectedEntry={selectedEntry}
                  selectedRun={selectedRun}
                  onViewFollowedResult={viewFollowedResult}
                  declared={manifest.parameters}
                  runnable={runnable}
                  newerRunDidNotSucceed={newerRunDidNotSucceed}
                />
              ))
            : null}

          {state.phase === 'settled' && state.snapshot !== undefined ? (
            <LastRunLabel
              run={runHistoryEntryFromSnapshot(state.snapshot, state.startedAt)}
              parameters={state.snapshot.parameters ?? state.params}
              parameterDisplayValues={state.snapshot.parameterDisplayValues}
              declared={manifest.parameters}
              variant="justFinished"
              finishedAt={ownFinishedAt}
            />
          ) : null}

          {state.phase === 'settled' && state.snapshot !== undefined && !ownRunSucceeded ? (
            <RunFailureAlert snapshot={state.snapshot} outcome={result} />
          ) : null}

          {state.phase === 'running' && state.startedAt != null ? (
            <RunStatus
              snapshot={state.snapshot}
              computingLabel={outputsLabel}
              startedAt={state.startedAt}
              elapsedMs={state.elapsedMs}
              onCancel={() => void cancel()}
              cancelling={state.cancelling}
            />
          ) : null}

          {

}
          {state.phase === 'running' ? (
            <SelectedRunSection
              selectedEntry={selectedEntry}
              selectedRun={selectedRun}
              declared={manifest.parameters}
            />
          ) : null}

          {state.phase === 'settled' && state.requestError != null ? (
            <div className="border-border border-t p-6">
              <Alert variant="destructive">
                <AlertTitle>Could not reach the job</AlertTitle>
                <AlertDescription>{state.requestError}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          {state.phase === 'settled' && ownRunSucceeded && result?.outcome === 'noPayload' ? (
            <NoPayload reason={result.reason} runPageUrl={state.snapshot?.runPageUrl} />
          ) : null}
        </Card>

        <Card className="overflow-hidden p-0 [&>*:first-child]:border-t-0">
          <PublishedBlocks
            blocks={manifest.blocks}
            downloadRunId={displayedRun?.jobRunId}
            outputs={displayedOutputs}
            unmatchedState={unmatchedOutputState}
            onRetry={run}
          />
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-6xl p-6">{children}</div>
    </div>
  );
}

function activeRunOf(lastRun: LastRunState): ActiveRun | undefined {
  return lastRun.status === 'found' || lastRun.status === 'none' ? lastRun.active : undefined;
}

function outputsFrom(result: RunOutcome | undefined): MatchedOutput[] {
  return result?.outcome === 'outputs' ? result.outputs : [];
}

function hasWrittenFiles(result: RunOutcome | undefined): boolean {
  return outputsFrom(result).some((output) => (output.files?.length ?? 0) > 0);
}

function runHistoryEntry(
  run: LastRunSummary,
  parameters?: Record<string, string>,
  parameterDisplayValues?: Record<string, string>,
  resultState?: string,
  lifeCycleState?: string,
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
): { displayedRun?: RunHistoryEntry; outputs: MatchedOutput[]; unmatchedState: UnmatchedOutputState } {
  if (selectedEntry !== undefined) {
    // Explicit history selection always wins, including while its result is loading or unavailable.
    return {
      displayedRun: selectedEntry,
      outputs: selectedRun?.status === 'found' ? outputsFrom(selectedRun.outcome) : [],
      unmatchedState: selectedRun?.status === 'found' || selectedRun?.status === 'unavailable' ? 'omitted' : 'loading',
    };
  }
  const lastSuccessful = lastSuccessfulRunEntry(lastRun);
  if (state.phase === 'running') {
    return { displayedRun: lastSuccessful, outputs: [], unmatchedState: 'running' };
  }
  if (state.phase === 'settled' && state.snapshot !== undefined) {
    return {
      displayedRun: runHistoryEntryFromSnapshot(state.snapshot, state.startedAt),
      outputs: outputsFrom(state.snapshot.result),
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
        followed.snapshot?.lifeCycleState,
      ),
      outputs: outputsFrom(followed.outcome),
      unmatchedState: 'omitted',
    };
  }
  if (lastRun.status === 'found') {
    return { displayedRun: lastSuccessful, outputs: outputsFrom(lastRun.result), unmatchedState: 'omitted' };
  }
  return { outputs: [], unmatchedState: followed.following ? 'running' : 'beforeRun' };
}

export function RunFailureAlert({ snapshot, outcome }: { snapshot: RunSnapshot; outcome?: RunOutcome }) {
  const reason = snapshot.stateMessage?.trim() ||
    (outcome?.outcome === 'noPayload' ? outcome.reason : undefined) ||
    `The run ended in state ${snapshot.resultState ?? snapshot.lifeCycleState ?? 'UNKNOWN'}.`;
  return (
    <div className="border-border border-t px-6 py-4">
      <Alert variant="destructive">
        <AlertTitle>The run did not finish successfully</AlertTitle>
        <AlertDescription>
          <p className="whitespace-pre-wrap break-words">{reason}</p>
          {hasWrittenFiles(outcome) ? (
            <p className="mt-2">Completed file writes are available below. Other outputs may be missing.</p>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function runHistoryEntryFromSnapshot(snapshot: RunSnapshot, startedAt: number | undefined): RunHistoryEntry {
  return {
    jobRunId: snapshot.jobRunId,
    ...(startedAt === undefined ? {} : { startTime: startedAt }),
    ...(snapshot.setupDurationMs === undefined ? {} : { setupDurationMs: snapshot.setupDurationMs }),
    ...(snapshot.executionDurationMs === undefined ? {} : { executionDurationMs: snapshot.executionDurationMs }),
    ...(snapshot.runPageUrl === undefined ? {} : { runPageUrl: snapshot.runPageUrl }),
    ...(snapshot.resultState === undefined ? {} : { resultState: snapshot.resultState }),
    ...(snapshot.lifeCycleState === undefined ? {} : { lifeCycleState: snapshot.lifeCycleState }),
    ...(snapshot.parameters === undefined ? {} : { parameters: snapshot.parameters }),
    ...(snapshot.parameterDisplayValues === undefined ? {} : { parameterDisplayValues: snapshot.parameterDisplayValues }),
  };
}

// Missing recorded parameters stay absent; published defaults would misstate what actually ran.
function lastRunValuesOf(lastRun: LastRunState): Record<string, string> | undefined {
  const active = activeRunOf(lastRun);
  if (active?.parameters !== undefined) {
    return active.parameters;
  }
  return lastRun.status === 'found' ? lastRun.parameters : undefined;
}

function LandingBlock({
  section,
  lastRun,
  followedActive,
  followedOutcome,
  followedSnapshot,
  followedFinishedAt,
  selectedEntry,
  selectedRun,
  onViewFollowedResult,
  declared,
  runnable,
  newerRunDidNotSucceed,
}: {
  section: LandingSection;
  lastRun: LastRunState;
  followedActive?: ActiveRun;
  followedOutcome?: RunOutcome;
  followedSnapshot?: RunSnapshot;
  followedFinishedAt?: number;
  selectedEntry?: RunHistoryEntry;
  selectedRun?: SelectedRunState;
  onViewFollowedResult: () => void;
  declared: AppParameter[];
  runnable: boolean;
  newerRunDidNotSucceed: boolean;
}) {
  if (section.kind === 'activeRun') {
    return followedActive === undefined ? null : <ActiveRunBanner active={followedActive} declared={declared} />;
  }

  if (section.kind === 'followedResult') {

    return followedActive === undefined || followedOutcome === undefined ? null : (
      <RunResult
        run={followedActive.run}
        parameters={followedActive.parameters}
        parameterDisplayValues={followedActive.parameterDisplayValues}
        result={followedOutcome}
        snapshot={followedSnapshot}
        declared={declared}
        variant="justFinished"
        finishedAt={followedFinishedAt}
      />
    );
  }

  if (section.kind === 'selectedRun') {
    return (
      <SelectedRunSection
        selectedEntry={selectedEntry}
        selectedRun={selectedRun}
        declared={declared}
      />
    );
  }

  if (section.kind === 'followedResultAvailable') {

    return followedActive === undefined || followedOutcome === undefined ? null : (
      <div className="border-border bg-muted/40 border-t px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge variant="secondary" className="font-normal">
            Run finished
          </Badge>
          <p className="text-muted-foreground flex-1 text-xs">{FOLLOWED_RESULT_AVAILABLE_OFFER}</p>
          <Button variant="outline" size="sm" onClick={onViewFollowedResult}>
            View the finished run
          </Button>
        </div>
      </div>
    );
  }

  if (section.kind === 'lastRun') {
    return lastRun.status !== 'found' ? null : (
      <RunResult
        run={lastRun.run}
        parameters={lastRun.parameters}
        parameterDisplayValues={lastRun.parameterDisplayValues}
        result={lastRun.result}
        declared={declared}
        variant={section.superseded ? 'superseded' : 'last'}
        newerRunDidNotSucceed={newerRunDidNotSucceed}
      />
    );
  }

  if (section.reason === 'never') {
    return null;
  }

  return runnable ? (
    <div className="border-border text-muted-foreground border-t px-6 py-12 text-center text-sm">
      {EMPTY_LANDING_MESSAGES[section.reason]}
    </div>
  ) : null;
}

function SelectedRunSection({
  selectedEntry,
  selectedRun,
  declared,
}: {
  selectedEntry?: RunHistoryEntry;
  selectedRun?: SelectedRunState;
  declared: AppParameter[];
}) {
  if (selectedEntry === undefined || selectedRun === undefined) {
    return null;
  }
  if (selectedRun.status === 'loading') {
    return (
      <div className="border-border text-muted-foreground border-t px-6 py-12 text-center text-sm">
        Loading run {selectedEntry.jobRunId}…
      </div>
    );
  }
  if (selectedRun.status === 'unavailable') {

    return (
      <div className="border-border border-t p-6">
        <Alert variant="destructive">
          <AlertTitle>That run could not be loaded</AlertTitle>
          <AlertDescription>{selectedRun.reason}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <RunResult
      run={{
        jobRunId: selectedEntry.jobRunId,
        ...(selectedEntry.endTime === undefined ? {} : { endTime: selectedEntry.endTime }),
        ...(selectedEntry.startTime === undefined ? {} : { startTime: selectedEntry.startTime }),
        ...(selectedEntry.runPageUrl === undefined ? {} : { runPageUrl: selectedEntry.runPageUrl }),
      }}
      parameters={selectedEntry.parameters}
      parameterDisplayValues={selectedEntry.parameterDisplayValues}
      result={selectedRun.outcome}
      snapshot={selectedRun.snapshot}
      declared={declared}
      variant="historical"
    />
  );
}

function RunResult({
  run,
  parameters,
  parameterDisplayValues,
  result,
  snapshot,
  declared,
  variant,
  finishedAt,
  newerRunDidNotSucceed = false,
}: {
  run: LastRunSummary;
  parameters?: Record<string, string>;
  parameterDisplayValues?: Record<string, string>;
  result: RunOutcome;
  snapshot?: RunSnapshot;
  declared: AppParameter[];
  variant: LastRunVariant;
  finishedAt?: number;
  newerRunDidNotSucceed?: boolean;
}) {
  return (
    <>
      <LastRunLabel
        run={run}
        parameters={parameters}
        parameterDisplayValues={parameterDisplayValues}
        declared={declared}
        variant={variant}
        finishedAt={finishedAt}
        newerRunDidNotSucceed={newerRunDidNotSucceed}
      />
      {snapshot?.terminal && !isSuccessfulResultState(snapshot.resultState) ? (
        <RunFailureAlert snapshot={snapshot} outcome={result} />
      ) : result.outcome === 'noPayload' ? (
        <NoPayload reason={result.reason} runPageUrl={run.runPageUrl} />
      ) : null}
    </>
  );
}

export function PublishedBlocks({
  blocks,
  downloadRunId,
  outputs,
  unmatchedState,
  onRetry,
}: {
  blocks: AppManifestBlock[];
  downloadRunId?: string;
  outputs: MatchedOutput[];
  unmatchedState: UnmatchedOutputState;
  onRetry: () => void;
}) {
  const matchedBlocks = matchPublishedBlocks(blocks, outputs);
  return (
    <>
      {matchedBlocks.map((match) =>
        match.kind === 'markdown' ? (
          <MarkdownBlock key={match.key} block={match.block} />
        ) : (
          <PublishedOutputBlock
            key={match.key}
            block={match.block}
            downloadRunId={downloadRunId}
            output={match.output}
            unmatchedState={unmatchedState}
            onRetry={onRetry}
          />
        ),
      )}
    </>
  );
}

function PublishedOutputBlock({
  block,
  downloadRunId,
  output,
  unmatchedState,
  onRetry,
}: {
  block: AppOutputBlock;
  downloadRunId?: string;
  output?: MatchedOutput;
  unmatchedState: UnmatchedOutputState;
  onRetry: () => void;
}) {
  if (output === undefined) {
    return (
      <section className="border-border border-t [&>*]:border-t-0">
        <OutputHeading title={outputTitle(block)} />
        <UnmatchedOutput state={unmatchedState} />
      </section>
    );
  }
  return (
    <OutputSection
      downloadRequest={downloadRunId && block.fileOutput ? { runId: downloadRunId, outputId: block.id } : undefined}
      output={{
        ...output,
        title: outputTitle(block),
        ...(block.chartSpec === undefined ? { chartSpec: undefined } : { chartSpec: block.chartSpec }),
      }}
      onRetry={onRetry}
    />
  );
}

function UnmatchedOutput({ state }: { state: UnmatchedOutputState }) {
  if (state === 'omitted') {
    return <MissingOutput reason="The run finished without returning a result for this published output." />;
  }
  return (
    <div className="border-border text-muted-foreground border-t px-6 py-8 text-left text-sm">
      {state === 'running'
        ? 'This output will appear when the current run finishes.'
        : state === 'loading'
          ? 'Loading this output…'
          : 'Run the app to populate this output.'}
    </div>
  );
}

function outputTitle(block: AppOutputBlock): string {
  return block.label !== '' ? block.label : block.nodeId !== '' ? block.nodeId : block.id;
}

function OutputHeading({ title }: { title: string }) {
  return (
    <div className="border-border flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-6 pt-5 pb-1">
      <h2 className="text-sm font-medium">{title}</h2>
    </div>
  );
}

const FILE_OUTPUT_LABELS: Record<FileOutputBehavior, string> = {
  run_artifact: 'Generated file',
  shared_append: 'Shared file · append mode',
  shared_workbook_update: 'Shared workbook · updated',
};

export function OutputSection({
  output,
  onRetry,
  downloadRequest,
}: {
  output: MatchedOutput;
  onRetry: () => void;
  downloadRequest?: { runId: string; outputId: string };
}) {
  const { outcome, fileBehavior } = output;
  const isSharedFile = fileBehavior === 'shared_append' || fileBehavior === 'shared_workbook_update';
  return (
    <section className="border-border border-t [&>*]:border-t-0">
      <OutputHeading title={output.title} />
      {outcome.outcome === 'result' ? (
        <ResultSection payload={outcome.payload} chartSpec={output.chartSpec} />
      ) : null}
      {output.files && downloadRequest && (
        <div className="px-6 py-4 text-sm">
          {output.files.length > 0 ? (
            <>
              <p className="mb-2 font-medium">
                {fileBehavior === 'run_artifact' && output.files.length > 1
                  ? 'Generated files'
                  : fileBehavior
                    ? FILE_OUTPUT_LABELS[fileBehavior]
                    : output.files.length === 1 ? 'File' : 'Files'}
                {output.files.length > 1 ? ` · ${output.files.length}` : ''}
              </p>
              <OutputFileDownloads
                key={`${downloadRequest.runId}:${downloadRequest.outputId}`}
                files={output.files}
                runId={downloadRequest.runId}
                outputId={downloadRequest.outputId}
                outputTitle={output.title}
              />
              <p className="text-muted-foreground mt-3 text-xs">
                {fileBehavior === 'run_artifact'
                  ? 'Later App runs use separate destinations. '
                  : 'Downloads the current contents at the saved destination, including changes made after this run. '}
                Files are retained until the volume owner removes them.
              </p>
              {isSharedFile && outcome.outcome === 'result' && (
                <p className="text-muted-foreground mt-2 text-xs">
                  The preview and row count are as of the selected run and may differ from the file downloaded now.
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">This run did not record any completed files for this output.</p>
          )}
        </div>
      )}
      {outcome.outcome === 'computeError' ? <ComputeError payload={outcome.payload} onRetry={onRetry} /> : null}
      {outcome.outcome === 'malformed' ? <MalformedOutput reason={outcome.reason} /> : null}
      {outcome.outcome === 'missing' && !output.files?.length ? <MissingOutput reason={outcome.reason} /> : null}
    </section>
  );
}

function ResultSection({ payload, chartSpec }: { payload: OkPayload; chartSpec?: AppChartSpec }) {
  if (payload.rows.length === 0) {
    return (
      <>
        <EmptyResult />
        {chartSpec === undefined && <ResultFooter payload={payload} />}
      </>
    );
  }
  const chart =
    chartSpec === undefined
      ? undefined
      : translatePublishedChart({ chartSpec, schema: payload.schema });
  if (chart !== undefined && chart.ok) {
    return (
      <>
        <TruncatedChartWarning payload={payload} />
        <div className="px-6 py-4">
          <Suspense fallback={<p className="text-muted-foreground py-8 text-center text-sm">Loading chart…</p>}>
            <LazyOutputChart plan={chart.plan} rows={payload.rows} fallback={<ResultGrid payload={payload} />} />
          </Suspense>
        </div>
      </>
    );
  }
  return (
    <>
      {chart === undefined ? null : <ChartRefusedNote refusal={chart.refusal} />}
      <ResultGrid payload={payload} />
    </>
  );
}

function TruncatedChartWarning({ payload }: { payload: OkPayload }) {
  if (payload.truncated !== true) {
    return null;
  }
  return (
    <div className="border-border border-t px-6 pt-4">
      <Alert>
        <AlertTitle>This chart is drawn from part of the result</AlertTitle>
        <AlertDescription>
          {`This chart uses only the ${payload.rows.length.toLocaleString()} rows shown in this preview. There may be categories, peaks and totals it does not show.`}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function ChartRefusedNote({ refusal }: { refusal: PublishedChartRefusal }) {
  return (
    <div className="border-border text-muted-foreground border-t px-6 pt-4 text-xs">
      {describePublishedChartRefusal(refusal)}
    </div>
  );
}

function describeOutputs(blocks: AppManifestBlock[]): string {
  const outputs = blocks.filter((block): block is AppOutputBlock => block.type === 'output');
  if (outputs.length === 1) {
    const only = outputs[0];
    return only.label !== '' ? only.label : only.nodeId !== '' ? only.nodeId : only.id;
  }
  return `${outputs.length} outputs`;
}
