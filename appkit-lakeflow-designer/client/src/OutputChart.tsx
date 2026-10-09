import { useChartUITokens } from '@databricks/appkit-ui/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import embed from 'vega-embed';

import { buildPublishedVegaLiteSpec, DESIGNER_CHART_COLORS } from './chartSpec';
import { preparePublishedChartData } from './chartData';
import type { PublishedChartPlan, PublishedChartRow } from './chartTranslation';

export interface OutputChartProps {
  plan: PublishedChartPlan;
  rows: readonly PublishedChartRow[];
  fallback: ReactNode;
}

export function OutputChart({ plan, rows, fallback }: OutputChartProps) {
  const ui = useChartUITokens();
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setFailed(false);
    // An embed may finish after cleanup. Its own mount keeps it away from a newer chart.
    const mount = document.createElement('div');
    container.appendChild(mount);
    const spec = buildPublishedVegaLiteSpec(
      plan,
      preparePublishedChartData(plan, rows),
      DESIGNER_CHART_COLORS,
      ui,
      getComputedStyle(container).fontFamily,
    );
    let disposed = false;
    let finalize: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    let width = Math.max(1, container.clientWidth);
    const onError = () => {
      if (!disposed) setFailed(true);
    };
    void embed(mount, spec, {
      actions: false,
      renderer: 'svg',
      width,
    })
      .then((result) => {
        if (disposed) {
          result.finalize();
          return;
        }
        finalize = result.finalize;
        observer = new ResizeObserver(() => {
          const nextWidth = container.clientWidth;
          if (nextWidth > 0 && nextWidth !== width) {
            width = nextWidth;
            void result.view.width(width).runAsync().catch(onError);
          }
        });
        observer.observe(container);
      })
      .catch(onError);
    return () => {
      disposed = true;
      observer?.disconnect();
      finalize?.();
      mount.remove();
    };
  }, [plan, rows, ui]);

  return (
    <>
      <div
        ref={host}
        className="min-w-0 w-full"
        hidden={failed}
        aria-label={plan.title ?? `${plan.yTitle} by ${plan.xTitle}`}
        data-testid="output-chart"
      />
      {failed ? (
        <>
          <p role="alert" className="text-muted-foreground text-sm">
            This chart could not be rendered. Its rows are shown instead.
          </p>
          {fallback}
        </>
      ) : null}
    </>
  );
}
