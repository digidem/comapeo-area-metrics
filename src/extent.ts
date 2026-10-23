import { Coverage } from './coverage.ts'
import { Grid, cellsBetween } from './grid.ts'
import { checkCellSize, checkOption } from './options.ts'
import { type ProjectedPoints, paintRecords } from './records.ts'
import {
	type Box,
	type Regions,
	Runs,
	type Span,
	connectedRegions,
	subtract,
	union,
} from './runs.ts'
import type { CommonOptions, XY, Records } from './types.ts'

export interface ExtentOptions extends CommonOptions {
	/** Records closer than this are joined into one area. Defaults to 5000. */
	linkingDistanceM?: number | undefined
	/** How far the extent reaches beyond the closed shape. Defaults to 500. */
	marginM?: number | undefined
	/**
	 * Encircled ground up to this area is filled in. Defaults to 25 km², that
	 * is 25e6.
	 */
	maxHoleAreaM2?: number | undefined
	/** Defaults to 100. */
	cellSizeM?: number | undefined
	/**
	 * Small clusters further than this from the largest are dropped. Defaults
	 * to 50000.
	 */
	strayDistanceM?: number | undefined
}

export interface Extent {
	/** Square metres. */
	area: number
	/** The ground the extent covers. */
	coverage: Coverage
}

/**
 * Grow every record by half the linking distance, fill small encircled holes,
 * shrink back to the margin, and drop far-off stray clusters.
 */
export function measureExtent(
	records: Records,
	{
		linkingDistanceM = 5000,
		marginM = 500,
		maxHoleAreaM2 = 25e6,
		cellSizeM = 100,
		strayDistanceM = 50000,
		...options
	}: ExtentOptions = {},
): Extent {
	checkCellSize(cellSizeM, linkingDistanceM / 2, 'linkingDistanceM / 2')
	checkOption(marginM >= 0, 'marginM', marginM, '>= 0')
	checkOption(maxHoleAreaM2 >= 0, 'maxHoleAreaM2', maxHoleAreaM2, '>= 0')
	checkOption(strayDistanceM >= 0, 'strayDistanceM', strayDistanceM, '>= 0')
	const grid = new Grid(cellSizeM)
	const { points, latitude } = paintRecords(
		records,
		options,
		grid,
		linkingDistanceM / 2,
	)
	const { area, runs } = closingExtent(grid, points, {
		linkM: linkingDistanceM,
		marginM,
		maxHoleM2: maxHoleAreaM2,
		strayM: strayDistanceM,
	})
	return { area, coverage: new Coverage(runs, cellSizeM, latitude ?? 0) }
}

export interface ClosingOptions {
	linkM: number
	marginM: number
	maxHoleM2: number
	strayM: number
}

/**
 * Runs of cells with the region each belongs to.
 */
interface RegionRuns extends Regions {
	runs: Runs
}

interface Measured {
	/** The id of the cluster's region. */
	id: number
	/** Cells that survived the shrink. */
	cellCount: number
	area: number
	/** The mean of the cluster's cell centres before the shrink, in metres. */
	centroid: XY
	/** Points inside the cluster. */
	points: number
	/** Separate UTC days those points were recorded on. */
	days: number
	/** The longest side of the box around those points. */
	spanM: number
}

export interface Cluster extends Measured {
	distanceM: number
	kept: boolean
}

const STRAY_MIN_DAYS = 3
const STRAY_MIN_SPAN_M = 1000

/**
 * Closes a grid on which every record has already been grown by half the
 * linking distance: finds the connected regions, fills small encircled holes,
 * shrinks back to the margin and drops stray clusters. `measureExtent` does
 * the growing when it paints the grid. Everything works on runs of cells, so
 * memory follows the painted cells rather than the box around them.
 */
export function closingExtent(
	grown: Grid,
	points: ProjectedPoints,
	{ linkM, marginM, maxHoleM2, strayM }: ClosingOptions,
): { area: number; clusters: Cluster[]; runs: Runs } {
	if (!grown.cellCount)
		return { area: 0, clusters: [], runs: Runs.build(() => {}) }
	const growM = linkM / 2
	const shrinkM = Math.max(0, growM - marginM)
	const { cellSize } = grown

	const painted = Runs.fromGrid(grown)
	const box = painted.bounds()
	const regions = { runs: painted, ...connectedRegions(painted) }
	const filled = fillEncircledGround(regions, box, {
		maxHoleM2,
		growM,
		cellSize,
	})
	const removedSpansIn = shrink(filled.runs, box, shrinkM, cellSize)
	const { measured, shrunk } = measureClusters(
		filled,
		removedSpansIn,
		points,
		cellSize,
	)
	const clusters = keepOrDrop(measured, strayM)
	const kept = new Uint8Array(measured.length + 1)
	let area = 0
	for (const cluster of clusters)
		if (cluster.kept) {
			kept[cluster.id] = 1
			area += cluster.area
		}
	return { area, clusters, runs: keptRuns(shrunk, kept) }
}

// Growing the records ate a band growM wide from the edge of every hole, so a
// gap in the grown shape is smaller than the ground it encircles. Treating the
// gap as a disc and adding the band back estimates that ground.
const encircledM2 = (gapM2: number, growM: number): number =>
	Math.PI * (Math.sqrt(gapM2 / Math.PI) + growM) ** 2

/**
 * The unpainted runs between the painted ones, row by row across the box,
 * including rows with nothing painted.
 */
function gapsOf(painted: Runs, box: Box): Runs {
	const { row, first, last } = painted
	let i = 0
	return Runs.build((push) => {
		for (let r = box.rowMin; r <= box.rowMax; r++) {
			let start = box.colMin
			for (; i < painted.length && row[i] === r; i++) {
				if (first[i] > start) push(r, start, first[i] - 1)
				start = last[i] + 1
			}
			if (start <= box.colMax) push(r, start, box.colMax)
		}
	})
}

/**
 * Gives every cell of a small enough gap the id of the cluster around it. A
 * gap reaching the edge of the box is open to the outside and is never filled.
 * Filled gaps are added as runs of their own, so a row's runs may touch.
 */
function fillEncircledGround(
	regions: RegionRuns,
	box: Box,
	{
		maxHoleM2,
		growM,
		cellSize,
	}: { maxHoleM2: number; growM: number; cellSize: number },
): RegionRuns {
	// Even the smallest gap is estimated at more than pi * growM².
	if (maxHoleM2 <= 0) return regions
	const gaps = gapsOf(regions.runs, box)
	const { ids: gapIds, sizes: gapSizes } = connectedRegions(gaps)
	const outside = new Uint8Array(gapSizes.length)
	for (let g = 0; g < gaps.length; g++)
		if (
			gaps.row[g] === box.rowMin ||
			gaps.row[g] === box.rowMax ||
			gaps.first[g] === box.colMin ||
			gaps.last[g] === box.colMax
		)
			outside[gapIds[g]] = 1
	const fillable = gapSizes.map(
		(cells, gap) =>
			gap > 0 &&
			!outside[gap] &&
			encircledM2(cells * cellSize ** 2, growM) <= maxHoleM2,
	)
	if (!fillable.includes(true)) return regions

	const painted = regions.runs
	const sizes = [...regions.sizes]
	const ids: number[] = []
	const around = new Int32Array(gapSizes.length)
	const gapBefore = (g: number, p: number) =>
		gaps.row[g] < painted.row[p] ||
		(gaps.row[g] === painted.row[p] && gaps.first[g] < painted.first[p])
	const runs = Runs.build((push) => {
		const add = (from: Runs, i: number, id: number) => {
			push(from.row[i], from.first[i], from.last[i])
			ids.push(id)
		}
		// Merge the filled gaps in among the painted runs, in order. Gaps after
		// the last painted run are all in the last row, so open and never filled.
		let g = 0
		for (let p = 0; p < painted.length; p++) {
			for (; g < gaps.length && gapBefore(g, p); g++) {
				const gap = gapIds[g]
				if (!fillable[gap]) continue
				// The cell above a gap's first cell is painted: otherwise it would
				// be part of the gap, or the gap would reach the edge of the box.
				around[gap] ||=
					regions.ids[painted.indexAt(gaps.row[g] - 1, gaps.first[g])]
				add(gaps, g, around[gap])
				sizes[around[gap]] += gaps.last[g] - gaps.first[g] + 1
			}
			add(painted, p, regions.ids[p])
		}
	})
	return { runs, ids: Int32Array.from(ids), sizes }
}

/**
 * The cells within `shrinkM` of the edge of the shape, which the extent then
 * leaves out, as a function giving the spans removed from a row. Edge cells
 * are the empty cells touching the shape; each row's runs of them sweep out a
 * stadium shape, a disc at each end and a band between.
 */
function shrink(
	shape: Runs,
	box: Box,
	shrinkM: number,
	cellSize: number,
): (row: number) => Span[] {
	// A radius of 0 removes only edge cells, which are empty anyway.
	if (shrinkM === 0) return () => []
	const edges = new Map<number, Span[]>()
	for (let row = box.rowMin - 1; row <= box.rowMax + 1; row++) {
		const here = union(shape.spansIn(row))
		const touching = union(
			here.map(([first, last]): Span => [first - 1, last + 1]),
			shape.spansIn(row - 1),
			shape.spansIn(row + 1),
		)
		const edge = subtract(touching, here)
		if (edge.length) edges.set(row, edge)
	}

	const reach = Math.ceil(shrinkM / cellSize) + 1
	return (row) => {
		let removed: Span[] = []
		const y = (row + 0.5) * cellSize
		for (let edgeRow = row - reach; edgeRow <= row + reach; edgeRow++) {
			const edge = edges.get(edgeRow)
			if (!edge) continue
			const cy = (edgeRow + 0.5) * cellSize
			const [firstRow, lastRow] = cellsBetween(
				cy - shrinkM,
				cy + shrinkM,
				cellSize,
			)
			if (row < firstRow || row > lastRow) continue
			const halfChord = Math.sqrt(
				Math.max(shrinkM * shrinkM - (y - cy) ** 2, 0),
			)
			const swept = edge.map(([first, last]) =>
				cellsBetween(
					(first + 0.5) * cellSize - halfChord,
					(last + 0.5) * cellSize + halfChord,
					cellSize,
				),
			)
			removed = union(removed, swept)
		}
		return removed
	}
}

/**
 * Sums up each cluster: its area after the shrink, its centroid before it, and
 * the points that fall inside it for the stray rule. Also returns the runs
 * left after the shrink, with the cluster of each.
 */
function measureClusters(
	{ runs, ids, sizes }: RegionRuns,
	removedSpansIn: (row: number) => Span[],
	points: ProjectedPoints,
	cellSize: number,
): { measured: Measured[]; shrunk: { runs: Runs; ids: number[] } } {
	const count = sizes.length - 1
	const keptCells = new Int32Array(count + 1)
	const sumX = new Float64Array(count + 1)
	const sumY = new Float64Array(count + 1)
	const shrunkIds: number[] = []
	const shrunkRuns = Runs.build((push) => {
		let removed: Span[] = []
		for (let i = 0; i < runs.length; i++) {
			const [row, id] = [runs.row[i], ids[i]]
			if (i === 0 || row !== runs.row[i - 1]) removed = removedSpansIn(row)
			const y = (row + 0.5) * cellSize
			// Cell by cell, in row order, so the sums match the notebook's exactly.
			for (let col = runs.first[i]; col <= runs.last[i]; col++) {
				sumX[id] += (col + 0.5) * cellSize
				sumY[id] += y
			}
			for (const [first, last] of subtract(
				[[runs.first[i], runs.last[i]]],
				removed,
			)) {
				keptCells[id] += last - first + 1
				push(row, first, last)
				shrunkIds.push(id)
			}
		}
	})

	const pointCount = new Int32Array(count + 1)
	const days = Array.from({ length: count + 1 }, () => new Set<number>())
	const box = Array.from({ length: count + 1 }, () => [
		Infinity,
		-Infinity,
		Infinity,
		-Infinity,
	])
	for (let i = 0; i < points.count; i++) {
		const [x, y] = [points.xs[i], points.ys[i]]
		const run = runs.indexAt(Math.floor(y / cellSize), Math.floor(x / cellSize))
		if (run < 0) continue
		const id = ids[run]
		pointCount[id]++
		days[id].add(points.days[i])
		const b = box[id]
		b[0] = Math.min(b[0], x)
		b[1] = Math.max(b[1], x)
		b[2] = Math.min(b[2], y)
		b[3] = Math.max(b[3], y)
	}

	const measured = Array.from({ length: count }, (_, i) => i + 1).map(
		(id): Measured => {
			const b = box[id]
			return {
				id,
				cellCount: keptCells[id],
				area: keptCells[id] * cellSize * cellSize,
				centroid: [sumX[id] / sizes[id], sumY[id] / sizes[id]],
				points: pointCount[id],
				days: days[id].size,
				spanM: pointCount[id] ? Math.max(b[1] - b[0], b[3] - b[2]) : 0,
			}
		},
	)
	return { measured, shrunk: { runs: shrunkRuns, ids: shrunkIds } }
}

/**
 * The runs of the clusters marked in `kept`, with runs that touch joined, as
 * filled holes leave them beside the runs around them.
 */
function keptRuns(
	{ runs, ids }: { runs: Runs; ids: number[] },
	kept: Uint8Array,
): Runs {
	return Runs.build((push) => {
		let [row, first, last] = [NaN, NaN, NaN]
		for (let i = 0; i < runs.length; i++) {
			if (!kept[ids[i]]) continue
			if (runs.row[i] === row && runs.first[i] === last + 1) last = runs.last[i]
			else {
				if (!Number.isNaN(row)) push(row, first, last)
				row = runs.row[i]
				first = runs.first[i]
				last = runs.last[i]
			}
		}
		if (!Number.isNaN(row)) push(row, first, last)
	})
}

/**
 * Ranks clusters by point count, then area, and drops strays: far from the
 * largest, and with points on few days or across a small area.
 */
function keepOrDrop(clusters: Measured[], strayM: number): Cluster[] {
	// Without points to tell them apart, the biggest cluster is the territory.
	// Position breaks any remaining tie so the order does not depend on the
	// order of the input.
	const ordered = [...clusters].sort(
		(a, b) =>
			b.points - a.points ||
			b.area - a.area ||
			a.centroid[0] - b.centroid[0] ||
			a.centroid[1] - b.centroid[1],
	)
	const [largest] = ordered
	return ordered.map((cluster) => {
		const distanceM = Math.hypot(
			cluster.centroid[0] - largest.centroid[0],
			cluster.centroid[1] - largest.centroid[1],
		)
		const stray =
			cluster !== largest &&
			distanceM > strayM &&
			(cluster.days < STRAY_MIN_DAYS || cluster.spanM < STRAY_MIN_SPAN_M)
		return { ...cluster, distanceM, kept: !stray }
	})
}
