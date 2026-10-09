import type { LazyExoticComponent } from 'react';
import { lazy } from 'react';

import type { OutputChart } from './OutputChart';

/**
 * The split point for every renderer heavy enough to deserve one, mirroring the shape the console's
 * own visualization package uses (`js/packages/visualization/src/v2/renderer/renderersLazy.tsx`):
 * each heavy renderer is reachable ONLY through a dynamic `import()`, and a `preload*` function
 * exposes that import so a caller can warm the chunk before it is needed.
 *
 * WHY THE INDIRECTION IS WORTH A FILE OF ITS OWN. `lazy()` is not what creates the chunk; the
 * dynamic `import()` is, and it only works while nothing static imports the same module. Collecting
 * those imports here makes that property one thing to check rather than a rule spread across every
 * call site. The `import type` above is erased at compile time and does NOT create a static edge.
 *
 * ROLLUP NAMES THE CHUNK AFTER THE MODULE FILE, so `OutputChart.tsx` yields `OutputChart-<hash>.js`
 * with no configuration. The console's copy annotates each import with a webpackChunkName magic
 * comment; that is a webpack directive, inert under Rollup, and deliberately not copied.
 */

const importOutputChart = () => import('./OutputChart');

export const LazyOutputChart: LazyExoticComponent<typeof OutputChart> = lazy(() =>
  importOutputChart().then((module) => ({ default: module.OutputChart })),
);

export function preloadOutputChart(): void {
  void importOutputChart();
}
