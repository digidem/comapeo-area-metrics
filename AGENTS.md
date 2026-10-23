# @comapeo/area-metrics

Footprint and extent area estimates for CoMapeo data, plus the Observable notebooks that explain the algorithms.

## Build & Test

```sh
npm test               # types, lint, knip, node:test
npm run coverage       # node:test under c8
npm run check:pkg      # build, publint, attw
npm run bench          # timings on the longitude and latitude cases
npm run format         # prettier (skips notebooks/)
npm run notebooks:preview | notebooks:build | notebooks:check | notebooks:format
```

## Layout

- `src/` - the published module. `index.ts` exports `measureFootprint` and `measureExtent`.
- `notebooks/` - Observable Notebook Kit notebooks (the documentation), with their own `vite.config.js` and scripts. Not type-checked, linted or prettier-formatted with the module; use `notebooks:format`.
- `test/fixtures/` - `cases.js` (metre-level records from the extent notebook's verification harness), `toLonLat`/`lonLatCases` in the same file (three of those cases as points and lines near the equator and at 60°N), and `*-golden.json`, the notebooks' own results for both, written by `generate.mjs`.

## Keeping the module and notebooks in sync

The module is a hand-maintained copy of the notebook code, not generated from it. When the algorithm changes in a notebook, port the change to `src/`, then run `node test/fixtures/generate.mjs`, which extracts the code cells from `notebooks/footprint.html`, `extent.html` and `scenarios.html` and rewrites the golden fixtures, and confirm `test/notebook-parity.test.ts` passes. The parity tests require identical areas and cluster fields.

| Notebook                                                                                                         | Module             |
| ---------------------------------------------------------------------------------------------------------------- | ------------------ |
| footprint: `Grid`, `popcount`, `WORD`, `simplifyLine`                                                            | `src/grid.ts`      |
| footprint: `calculateFootprint`, `footprintOf`                                                                   | `src/footprint.ts` |
| scenarios: `impliedPaths`, `buildRecords`, `projectRecords`, `metresProjection`, `lonLatDistanceM`               | `src/records.ts`   |
| extent: `Raster` (no counterpart: the module uses runs instead)                                                  | `src/runs.ts`      |
| extent: `extentOf`, `closingExtent`, `regions`, `fillEncircledGround`, `shrink`, `measureClusters`, `keepOrDrop` | `src/extent.ts`    |
| extent: the `runs` of `shapesForMap`                                                                             | `src/coverage.ts`  |

Intentional differences from the notebooks:

- Input is `{ points, lines }`, each read once, points first. Points are kept as four numbers each; the projection is centred on their median latitude (the first line's first latitude without points), and lines are then projected, painted and dropped one at a time.
- The projection is centred on the points' median latitude, not the mean over all sorted positions with implied-path vertices counted a second time. The lon/lat parity tests pass the notebooks' mean as `latitude`, so everything else compares exactly.
- There is no raster. `closingExtent` works on the grid's row runs: regions are found with union-find over runs in neighbouring rows, gaps are the unpainted runs across the box (open to the outside when they reach its edge), and the shrink gives each row the spans removed by nearby edge runs. Memory follows the painted cells and the number of rows in the box, not the box's area, which the notebook's one raster over everything runs out of when records are far apart. Areas are identical. A point inside a filled hole now counts towards its cluster, as in the notebook; `measureExtent` never produces one, because every point paints its own cell.
- Both functions return `{ area, coverage }`. `Coverage` (`src/coverage.ts`) wraps the final `Runs` and corresponds to the `runs` of the extent notebook's `shapesForMap`; there are no other map shapes (`tracesOf`, `cellsOf`). The extent's runs are those left after the shrink in kept clusters, with filled holes joined to the runs beside them. Clusters are still built inside `closingExtent` (the parity tests read them) but carry `distanceM` instead of a `reason` string.
- Positions without finite coordinates, and points without a finite time, are skipped; no records gives an area of 0.
- Longitudes are unwrapped from the middle of the widest gap between the points, so a project straddling the antimeridian stays in one piece.
- Options are checked (`src/options.ts`) and bad ones throw a `RangeError`.
- Implied paths are painted as bands only, since their vertices are points already painted as discs.
- The stray rule counts only points (count, days, span), not tracks, and ties on point count go to the bigger cluster rather than to the one further west. The notebook counts tracks too, so the per-cluster parity test compares cluster shapes only.
- Options are in metres and square metres (`linkingDistanceM`, `maxHoleAreaM2`, `strayDistanceM`) rather than the notebook's km and km² controls.

## Conventions

- TypeScript with erasable syntax only: Node runs `src/`, `test/` and `bench/` directly by stripping types. Relative imports use `.ts` extensions; `tsc -p tsconfig.build.json` rewrites them to `.js` in `dist/`.
- Functions, classes and types get multi-line `/** */` doc blocks; single-line ones only for properties.
- `#private` fields, not the `private` keyword.
