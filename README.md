# @comapeo/area-metrics

[![GitHub CI](https://github.com/digidem/comapeo-area-metrics/actions/workflows/test.yml/badge.svg)](https://github.com/digidem/comapeo-area-metrics/actions/workflows/test.yml)

> [!NOTE]
> Work in progress: this package is not yet published to npm, and its API may change before the first release.

Estimate how much ground a CoMapeo project covers from its observations and tracks. Two measures, both computed on the device:

- **Footprint**: the ground the team would have seen while collecting, the area within a buffer of every observation and track. The lower figure.
- **Extent**: the territory the team works in, the footprint's records joined into areas with small encircled holes filled and far-off strays dropped. The higher figure.

Both take milliseconds to tens of milliseconds on datasets of hundreds of observations and tracks.

## Installation

```sh
npm install @comapeo/area-metrics
```

ESM only. Requires Node.js 22 or later; it has no dependencies on Node or browser APIs.

## Usage

```js
import { measureExtent, measureFootprint } from '@comapeo/area-metrics'

const records = {
  points: [
    {
      coordinates: [-62.2, -3.5],
      time: Date.parse('2026-03-01T10:00Z'),
      device: 'a',
    },
  ],
  lines: [
    {
      coordinates: [
        [-62.21, -3.51],
        [-62.2, -3.5],
        [-62.19, -3.52],
      ],
      time: Date.parse('2026-03-01T09:00Z'),
    },
  ],
}

const { area: footprint } = measureFootprint(records)
const { area: extent } = measureExtent(records)
console.log(footprint / 1e6, extent / 1e6) // km²
```

All lengths are in metres, areas in square metres, times in milliseconds since the epoch. Both functions return `{ area, coverage }`: the area, and the ground it covers as runs of cells, for working out how much of it falls in other areas such as ecoregions (see [Coverage](#coverage)). This library sends nothing anywhere; what leaves the device is the caller's decision.

### Records

`records` is `{ points, lines }`. Each is an iterable read once, points first, so either can be a generator streaming rows from a database. Coordinates are `[longitude, latitude]`, as in GeoJSON.

- `points` yields `{ coordinates, time, device }`: single positions, such as observations. They are kept as four numbers each, to centre the projection on their median latitude and to join them into [implied paths](#implied-paths).
- `lines` yields `{ coordinates, time }`: sequences of positions, such as tracks, where `time` is when the line started. `coordinates` can itself be a lazy iterable. Each line is projected, painted and dropped before the next is read.

Positions without finite coordinates, and points without a finite `time`, are skipped. Longitudes should be between -180 and 180; a project that straddles the antimeridian is measured as one piece.

From comapeo-core with better-sqlite3, that looks like this (deleted documents and forks are the query's concern):

```js
const { area } = measureExtent({
  points: (function* () {
    for (const doc of observationQuery.iterate())
      yield {
        coordinates: [doc.lon, doc.lat],
        time: Date.parse(doc.createdAt),
        device: doc.originalVersionId.split('/')[0],
      }
  })(),
  lines: (function* () {
    for (const doc of trackQuery.iterate())
      yield {
        coordinates: doc.locations.map((l) => [
          l.coords.longitude,
          l.coords.latitude,
        ]),
        time: Date.parse(doc.createdAt),
      }
  })(),
})
```

The `device` only needs to be a stable per-device key; the core discovery id in `originalVersionId` is one.

### Options

Both functions take:

| Option         | Default                       | Meaning                                                                                                                                                                                                                       |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `impliedPaths` | `true`                        | Join nearby points into paths (see [below](#implied-paths))                                                                                                                                                                   |
| `latitude`     | median latitude of the points | The latitude the projection is centred on; without points, the first line's first latitude. Fixing it keeps the area steady as records are added, rather than shifting by a few tenths of a percent with the grid's alignment |

`measureFootprint` also takes:

| Option      | Default       | Meaning                                                     |
| ----------- | ------------- | ----------------------------------------------------------- |
| `bufferM`   | `500`         | How far around each record the team is assumed to have seen |
| `cellSizeM` | `bufferM / 5` | Grid resolution. Smaller is more accurate and slower        |

`measureExtent` also takes:

| Option             | Default | Meaning                                                              |
| ------------------ | ------- | -------------------------------------------------------------------- |
| `linkingDistanceM` | `5000`  | Records closer than this belong to one area of territory             |
| `marginM`          | `500`   | How far the extent reaches beyond the records                        |
| `maxHoleAreaM2`    | `25e6`  | Ground encircled by records is filled in up to this area             |
| `cellSizeM`        | `100`   | Grid resolution                                                      |
| `strayDistanceM`   | `50000` | Clusters further than this from the largest may be dropped as strays |

Both functions throw a `RangeError` for options that make no sense or would take too long: sizes that are not finite and positive (limits may be `Infinity`), a `cellSizeM` larger than `bufferM` or than half `linkingDistanceM`, or more than 1000 times smaller, and a `latitude` outside -90 to 90.

A cluster is dropped as a stray when it is further than `strayDistanceM` from the largest cluster and its points were recorded on fewer than 3 days or span less than 1 km: a training session or a trip outside the territory, rather than a separate area of it. Only points count here, on the assumption that they show where the team works: the largest cluster is the one with the most points (or, if no cluster has points, the biggest), and a cluster with lines but no points far from it is a stray.

### Implied paths

Consecutive points from the same `device` on the same UTC day, at most `maxGapMinutes` (default 120) and `maxDistanceM` (default 2000) apart, are assumed to have been walked between and are treated as a line. Pass `impliedPaths: false` to turn this off, or `{ maxGapMinutes, maxDistanceM }` to change the limits. Points without a `device` are treated as coming from one device.

### Coverage

`coverage` holds the cells the area was counted from, as runs along the rows of the measurement's grid, in an equirectangular projection about the records' latitude. Longitudes come out in [-180, 180), so a run crossing the antimeridian is given as two.

- `coverage.area`: square metres, the same as `area`.
- `coverage.cellSizeM`: the grid's cell size.
- `coverage.runs()`: each run as a strip one cell tall, `{ lat, lon0, lon1, areaM2 }`: the latitude of its centre line, its west and east edges and its area. Weighting each strip by the share of it inside another grid's cells gives that grid's areas exactly.
- `coverage.cells()`: the centre of every cell, `[lon, lat]`.
- `coverage.tally(classify)`: the area per key that `classify(lon, lat)` returns for each cell's centre; cells it returns `undefined` for are left out.

```js
const { coverage } = measureFootprint(records)
const byBiome = coverage.tally((lon, lat) => biomeAt(lon, lat))
```

## How it works

Records are projected to metres with an equirectangular projection about the points' median latitude, and every line is simplified (Douglas–Peucker) to half the cell size.

The **footprint** paints a disc of radius `bufferM` around every vertex and a band along every segment onto a sparse bit grid, one row of cells at a time, and counts the cells whose centre is covered. It is within 0.3 % of buffering and unioning the geometries exactly, at a hundredth of the time and a tenth of the memory. [Full details in the footprint notebook](https://observablehq.com/@gmaclennan/footprint).

The **extent** is a morphological closing on the same grid. It grows every record by half the linking distance, so records within that distance merge; numbers the connected clusters; fills enclosed gaps whose estimated area is under `maxHoleAreaM2`; shrinks the shape back, leaving `marginM` beyond the records; measures each cluster; and drops the strays. It works on runs of cells along the grid's rows rather than a raster, so its memory follows the cells the records cover and the number of rows between them, not the area of the box around them: a 1000 km track takes about 100 ms. [Full details in the extent notebook](https://observablehq.com/@gmaclennan/extent).

## Limitations

Points are held in memory, four numbers each, for the projection's centre and the implied paths. The extent walks every grid row between the northernmost and southernmost records, so records thousands of kilometres apart north to south add some milliseconds.

## License

MIT
