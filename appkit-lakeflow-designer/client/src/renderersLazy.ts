import type { LazyExoticComponent } from 'react';
import { lazy } from 'react';

import type { OutputChart } from './OutputChart';

// A heavy renderer keeps its own chunk only while nothing imports it statically, so every import
// goes through here (type-only imports are erased and do not count).
const importOutputChart = () => import('./OutputChart');

export const LazyOutputChart: LazyExoticComponent<typeof OutputChart> = lazy(() =>
  importOutputChart().then((module) => ({ default: module.OutputChart }))
);

export function preloadOutputChart(): void {
  void importOutputChart();
}
