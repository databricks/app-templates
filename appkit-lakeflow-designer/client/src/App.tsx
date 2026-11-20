import type { SetStateAction } from 'react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card } from '@databricks/appkit-ui/react';

import {
  type FileOutputBehavior,
  outputBlockTitle,
  type AppChartSpec,
  type AppManifestBlock,
  type AppOutputBlock,
  type AppParameter,
  UPLOAD_REFERENCE,
  APP_UPDATING_MESSAGE,
  type ActiveRun,
  type LastRunSummary,
  type RunHistoryEntry,
  type MatchedOutput,
  type OkPayload,
  type RunOutcome,
  type RunSnapshot,
} from '../../server/plugins/designer/client';
import { ActiveRunBanner } from './ActiveRunBanner';
import { GuardrailSummary } from './GuardrailSummary';
import {
  fetchAppConfig,
  initialValuesFor,
  refreshedValuesFor,
  uploadConfigurationKey,
  type AppConfigState,
  type NotRunnableReason,
} from './appConfig';
import { MarkdownBlock } from './MarkdownBlock';
import { OutputFileDownloads } from './OutputFileDownloads';
import type { PublishedChartRefusal } from './chartTranslation';
import { describePublishedChartRefusal, translatePublishedChart } from './chartTranslation';
import type { LandingSection } from './landingPlan';
import { FOLLOWED_RESULT_AVAILABLE_OFFER, planLandingArea } from './landingPlan';
import type { LastRunState } from './lastRun';
import { fetchLastRun } from './lastRun';
import type { LastRunVariant } from './LastRunLabel';
import { LastRunLabel, RunParametersDisclosureProvider } from './LastRunLabel';
import { relative } from './relativeTime';
import { useNow } from './useNow';
import { ParameterForm } from './ParameterForm';
import { LazyOutputChart, preloadOutputChart } from './renderersLazy';
import { RunHistorySelect } from './RunHistoryList';
import type { RunHistoryState, SelectedRunState } from './runHistory';
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
import { useDesignerRun } from './useDesignerRun';
import { useFollowedRun } from './useFollowedRun';
import { OutputHtml } from './OutputHtml';

import {
  hasWrittenFiles,
  matchPublishedBlocks,
  planRunDisplay,
  runHistoryEntryFromSnapshot,
  type RunDisplayPlan,
  type UnmatchedOutputState,
} from './runDisplay';

const EMPTY_LANDING_MESSAGES = {
  loading: 'Looking for the last run…',
  unavailable: 'The last run could not be loaded. Run the operator to compute a fresh result.',
} as const;

const CONFIGURATION_REFRESH_ERROR =
  'Could not refresh the app configuration. Try Run again after the app is available.';

const NOT_RUNNABLE_MESSAGES: Record<NotRunnableReason, string> = {
  noManifest: 'This app has no published outputs, so there is nothing to run. It may need republishing.',
  noJob: 'This app is not connected to a job yet, so it cannot run. Its publisher needs to finish setting it up.',
  updating: APP_UPDATING_MESSAGE,
};

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
  const retainedRunDisplay = useRef<RunDisplayPlan | undefined>(undefined);

  const formUntouched = useRef(true);
  const invalidateUploads = useCallback(() => {
    currentUploadReset.current += 1;
    setUploadReset(currentUploadReset.current);
  }, []);
  const refreshConfiguration = useCallback(async () => {
    const request = ++configRequest.current;
    const next = await fetchAppConfig();
    if (request !== configRequest.current) return false;
    if (next.status === 'loading') return false;
    const previous = currentConfig.current;
    if (next.status !== 'ready') {
      if (previous.status !== 'ready') setConfig(next);
      setConfigurationMessage(CONFIGURATION_REFRESH_ERROR);
      return false;
    }
    setConfigurationMessage((current) => (current === CONFIGURATION_REFRESH_ERROR ? undefined : current));
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
      setConfigurationMessage(
        next.manifest.parameters.some(({ type }) => type === 'file')
          ? 'The app’s storage or file inputs changed. Select your files again, then click Run.'
          : 'The app configuration changed. Review your inputs, then click Run.'
      );
    }
    return next.runnable && !changed;
  }, [invalidateUploads]);
  const uploadUnavailable = useCallback(() => {
    invalidateUploads();
    const current = currentConfig.current;
    if (current.status === 'ready') {
      const files = new Set(current.manifest.parameters.filter(({ type }) => type === 'file').map(({ name }) => name));
      setValues((previous) =>
        Object.fromEntries(Object.entries(previous).map(([name, value]) => [name, files.has(name) ? '' : value]))
      );
    }
    setConfigurationMessage('An upload is no longer available. Select your files again, then click Run.');
    void refreshConfiguration();
  }, [invalidateUploads, refreshConfiguration]);
  const { state, start, cancel, reset } = useDesignerRun(uploadUnavailable);
  const [history, setHistory] = useState<RunHistoryState>({ status: 'loading' });
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const historyGeneration = useRef(0);

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

  const updating = config.status === 'ready' && config.notRunnableReason === 'updating';
  useEffect(() => {
    if (!updating) return;
    let cancelled = false;
    const refresh = async () => {
      await refreshConfiguration();
      if (!cancelled) timer = setTimeout(() => void refresh(), 3000);
    };
    let timer = setTimeout(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [updating, refreshConfiguration]);

  useEffect(() => {
    if (config.status === 'ready') {
      document.title = config.manifest.appName;
    }
  }, [config]);

  useEffect(() => {
    const controller = new AbortController();
    const cancel = applyUnlessCancelled(fetchLastRun(controller.signal), setLastRun);
    return () => {
      controller.abort();
      cancel();
    };
  }, [ownFinishedRunId, followedFinishedRunId]);

  const historyEnabled = config.status === 'ready' && config.runnable;

  useEffect(() => {
    if (!historyEnabled) {
      return undefined;
    }
    historyGeneration.current += 1;
    setHistoryLoadingMore(false);
    setHistoryError(undefined);
    setHistory((prev) => (prev.status === 'found' ? prev : { status: 'loading' }));
    const controller = new AbortController();
    const cancel = applyUnlessCancelled(
      fetchRunHistory(RUN_HISTORY_FIRST_WINDOW, undefined, controller.signal),
      setHistory
    );
    return () => {
      historyGeneration.current += 1;
      controller.abort();
      cancel();
    };
  }, [historyEnabled, ownFinishedRunId, followedFinishedRunId]);

  const loadOlderRuns = async () => {
    if (history.status !== 'found' || !history.nextPageToken || historyLoadingMore) return;
    const generation = historyGeneration.current;
    setHistoryLoadingMore(true);
    setHistoryError(undefined);
    const page = await fetchRunHistory(RUN_HISTORY_FIRST_WINDOW, history.nextPageToken);
    if (generation !== historyGeneration.current) return;
    setHistoryLoadingMore(false);
    if (page.status !== 'found') {
      setHistoryError(page.status === 'unavailable' ? page.reason : 'Could not load older runs. Try again.');
      return;
    }
    const runs = [...new Map([...history.runs, ...page.runs].map((run) => [run.jobRunId, run])).values()];
    setHistory({ ...page, runs });
  };

  useEffect(() => {
    const jobRunId = selectedEntry?.jobRunId;
    if (jobRunId === undefined) {
      return undefined;
    }
    setSelectedRun({ status: 'loading' });
    return applyUnlessCancelled(fetchRunResult(jobRunId), setSelectedRun);
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
    )
      return;
    formUntouched.current = false;
    setValues(next);
  };
  const clearSelection = () => {
    setSelectedEntry(undefined);
    setSelectedRun(undefined);
  };
  const runWithValues = async (runValues: Record<string, string>, signal?: AbortSignal) => {
    if (submissionPending.current || state.phase === 'running') return;
    submissionPending.current = true;
    try {
      // Refresh again after upload: publishing can overlap a long-running file transfer.
      if (!(await refreshConfiguration()) || signal?.aborted || uploadReset !== currentUploadReset.current) return;
      const current = currentConfig.current;
      if (current.status !== 'ready' || uploadConfigurationKey(current.manifest) !== uploadConfigurationKey(manifest))
        return;
      const currentValues = refreshedValuesFor(manifest, current.manifest, runValues);
      if (
        current.manifest.parameters.some(
          ({ name, type }) => type === 'file' && !UPLOAD_REFERENCE.test(currentValues[name] ?? '')
        )
      ) {
        setConfigurationMessage('Select your files again, then click Run.');
        return;
      }
      formUntouched.current = false;
      setValues(currentValues);
      const previousDisplay = planRunDisplay(
        state,
        followed,
        lastRun,
        selectedEntry,
        selectedRun,
        retainedRunDisplay.current
      );
      retainedRunDisplay.current = previousDisplay.unmatchedState === 'omitted' ? previousDisplay : undefined;
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

  const result = state.snapshot?.result;
  const ownRunSucceeded = state.phase === 'settled' && isSuccessfulResultState(state.snapshot?.resultState);
  const ownFinishedAt = state.startedAt === undefined ? undefined : state.startedAt + state.elapsedMs;
  const {
    displayedRun,
    outputs: displayedOutputs,
    diagnostics,
    unmatchedState: unmatchedOutputState,
    showPreviousRunLabel,
  } = planRunDisplay(state, followed, lastRun, selectedEntry, selectedRun, retainedRunDisplay.current);
  const newerRunDidNotSucceed =
    selectedEntry === undefined &&
    lastRun.status === 'found' &&
    history.status === 'found' &&
    hasNewerUnsuccessfulRun(history.runs, lastRun.run.endTime);
  const historyState: RunHistoryState = !runnable && notRunnableReason === 'noJob' ? { status: 'noJob' } : history;

  return (
    <Shell>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{manifest.appName}</h1>
          {manifest.subtitle === undefined ? null : (
            <p className="text-muted-foreground mt-1 text-sm">{manifest.subtitle}</p>
          )}
          {manifest.provenance === undefined ? null : <PublicationTime {...manifest.provenance} />}
        </div>
        <div className="flex max-w-full flex-wrap items-start justify-end gap-2">
          {runnable || notRunnableReason === 'noJob' ? (
            <RunHistorySelect
              state={historyState}
              displayedRun={displayedRun}
              onSelect={selectRun}
              onLoadMore={() => void loadOlderRuns()}
              loadingMore={historyLoadingMore}
              loadMoreError={historyError}
            />
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <div className="grid gap-6">
        <Card className={`overflow-hidden p-0 ${manifest.parameters.length === 0 ? 'gap-0' : ''}`}>
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

          {!runnable && notRunnableReason !== undefined ? (
            <div className="border-border border-t px-6 py-4">
              <Alert>
                <AlertTitle>Not ready to run</AlertTitle>
                <AlertDescription>{NOT_RUNNABLE_MESSAGES[notRunnableReason]}</AlertDescription>
              </Alert>
            </div>
          ) : null}

          {!showPreviousRunLabel &&
          (state.phase === 'idle' || (state.phase === 'settled' && state.snapshot === undefined))
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
                  onViewFollowedResult={clearSelection}
                  declared={manifest.parameters}
                  runnable={runnable}
                  newerRunDidNotSucceed={newerRunDidNotSucceed}
                />
              ))
            : null}

          {state.phase === 'settled' && state.snapshot !== undefined ? (
            <LastRunLabel
              run={runHistoryEntryFromSnapshot(state.snapshot, state.startedAt, state.params)}
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
              trackingError={state.trackingError}
              cancelError={state.cancelError}
            />
          ) : null}

          {state.phase === 'running' ? (
            <SelectedRunSection
              selectedEntry={selectedEntry}
              selectedRun={selectedRun}
              declared={manifest.parameters}
            />
          ) : null}

          {showPreviousRunLabel && displayedRun !== undefined ? (
            <LastRunLabel
              run={displayedRun}
              parameters={displayedRun.parameters}
              parameterDisplayValues={displayedRun.parameterDisplayValues}
              declared={manifest.parameters}
              variant="superseded"
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
            <NoPayload reason={result.reason} />
          ) : null}
        </Card>

        <GuardrailSummary diagnostics={diagnostics} />
        <PublishedBlocks
          blocks={manifest.blocks}
          downloadRunId={displayedRun?.jobRunId}
          outputs={displayedOutputs}
          unmatchedState={unmatchedOutputState}
          onRetry={run}
        />
      </div>
    </Shell>
  );
}

function PublicationTime({
  publishedAt,
  generatorVersion,
}: {
  publishedAt: number;
  generatorVersion?: string | number;
}) {
  const now = useNow();
  return (
    <p
      className="text-muted-foreground mt-1 text-xs"
      title={generatorVersion === undefined ? undefined : `Generated by Designer app generator v${generatorVersion}`}
    >
      {`Flow published ${relative(publishedAt, now)}, ${new Date(publishedAt).toLocaleString()}.`}
    </p>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto max-w-6xl p-6">
        <RunParametersDisclosureProvider>{children}</RunParametersDisclosureProvider>
      </div>
    </div>
  );
}

// Applies a loaded value unless the effect was cleaned up first; returns that cleanup.
function applyUnlessCancelled<T>(load: Promise<T>, apply: (value: T) => void): () => void {
  let cancelled = false;
  void load.then((value) => {
    if (!cancelled) apply(value);
  });
  return () => {
    cancelled = true;
  };
}

function activeRunOf(lastRun: LastRunState): ActiveRun | undefined {
  return lastRun.status === 'found' || lastRun.status === 'none' ? lastRun.active : undefined;
}

export function RunFailureAlert({ snapshot, outcome }: { snapshot: RunSnapshot; outcome?: RunOutcome }) {
  const reason =
    outcome?.failureReason ||
    snapshot.stateMessage?.trim() ||
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
    return <SelectedRunSection selectedEntry={selectedEntry} selectedRun={selectedRun} declared={declared} />;
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
        <NoPayload reason={result.reason} />
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
  const matchedBlocks = matchPublishedBlocks(blocks, outputs).filter((match) => {
    if (match.kind === 'output') {
      if (match.output?.disabled === true) return false;
      if (match.output !== undefined) return true;
    }
    return unmatchedState === 'omitted' || match.block.hideUntilResults !== true;
  });
  if (matchedBlocks.length === 0) return null;
  return (
    <Card className="overflow-hidden p-0 [&>*:first-child]:border-t-0">
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
        )
      )}
    </Card>
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
        <OutputHeading title={outputBlockTitle(block)} />
        <UnmatchedOutput state={unmatchedState} />
      </section>
    );
  }
  return (
    <OutputSection
      downloadRequest={downloadRunId && block.fileOutput ? { runId: downloadRunId, outputId: block.id } : undefined}
      executionKey={downloadRunId}
      output={{ ...output, title: outputBlockTitle(block), chartSpec: block.chartSpec }}
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
  executionKey,
  output,
  onRetry,
  downloadRequest,
}: {
  output: MatchedOutput;
  executionKey?: string;
  onRetry: () => void;
  downloadRequest?: { runId: string; outputId: string };
}) {
  if (output.disabled === true) return null;
  const { outcome, fileBehavior } = output;
  const isSharedFile = fileBehavior === 'shared_append' || fileBehavior === 'shared_workbook_update';
  return (
    <section className="border-border border-t [&>*]:border-t-0">
      <OutputHeading title={output.title} />
      {outcome.outcome === 'html' ? (
        <OutputHtml key={`${output.key}:${executionKey}`} html={outcome.html} title={output.title} />
      ) : null}
      {outcome.outcome === 'result' ? <ResultSection payload={outcome.payload} chartSpec={output.chartSpec} /> : null}
      {output.files && downloadRequest && (
        <div className="px-6 py-4 text-sm">
          {output.files.length > 0 ? (
            <>
              <p className="mb-2 font-medium">
                {fileBehavior === 'run_artifact' && output.files.length > 1
                  ? 'Generated files'
                  : fileBehavior
                    ? FILE_OUTPUT_LABELS[fileBehavior]
                    : output.files.length === 1
                      ? 'File'
                      : 'Files'}
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
  const chart = chartSpec === undefined ? undefined : translatePublishedChart({ chartSpec, schema: payload.schema });
  if (chart?.ok) {
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
  return outputs.length === 1 ? outputBlockTitle(outputs[0]) : `${outputs.length} outputs`;
}
