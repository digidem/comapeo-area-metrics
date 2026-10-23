import { metresPerDegree } from './records.ts'
import type { Runs } from './runs.ts'
import type { Position } from './types.ts'

/**
 * One run of a coverage as a strip one cell tall: the latitude of its centre
 * line, its west and east edges in degrees, and its area.
 */
export interface CoverageRun {
	lat: number
	lon0: number
	lon1: number
	areaM2: number
}

/**
 * The ground a measurement counted: runs of cells along the rows of its grid,
 * in an equirectangular projection about the latitude the records were
 * measured at. Longitudes are given in [-180, 180).
 */
export class Coverage {
	readonly cellSizeM: number
	/** Square metres: the number of cells times the area of one. */
	readonly area: number
	#runs: Runs
	#xScale: number
	#yScale: number

	constructor(runs: Runs, cellSizeM: number, latitude: number) {
		this.#runs = runs
		this.cellSizeM = cellSizeM
		const [xScale, yScale] = metresPerDegree(latitude)
		this.#xScale = xScale
		this.#yScale = yScale
		let cells = 0
		for (let i = 0; i < runs.length; i++)
			cells += runs.last[i] - runs.first[i] + 1
		this.area = cells * cellSizeM * cellSizeM
	}

	/**
	 * Each run as a strip one cell tall. A run crossing the antimeridian comes
	 * as two strips, one either side.
	 */
	*runs(): Generator<CoverageRun> {
		const { row, first, last, length } = this.#runs
		const cellSize = this.cellSizeM
		for (let i = 0; i < length; i++) {
			const lat = this.#latitudeOf(row[i])
			const areaM2 = (last[i] - first[i] + 1) * cellSize * cellSize
			const west = (first[i] * cellSize) / this.#xScale
			const east = ((last[i] + 1) * cellSize) / this.#xScale
			const lon0 = wrap(west)
			const lon1 = lon0 + (east - west)
			if (lon1 <= 180) yield { lat, lon0, lon1, areaM2 }
			else {
				const share = (180 - lon0) / (lon1 - lon0)
				yield { lat, lon0, lon1: 180, areaM2: areaM2 * share }
				yield {
					lat,
					lon0: -180,
					lon1: lon1 - 360,
					areaM2: areaM2 * (1 - share),
				}
			}
		}
	}

	/**
	 * The centre of every cell, run by run.
	 */
	*cells(): Generator<Position> {
		const { row, first, last, length } = this.#runs
		const cellSize = this.cellSizeM
		for (let i = 0; i < length; i++) {
			const lat = this.#latitudeOf(row[i])
			for (let col = first[i]; col <= last[i]; col++)
				yield [wrap(((col + 0.5) * cellSize) / this.#xScale), lat]
		}
	}

	/**
	 * The area of the cells `classify` puts under each key, judged by each
	 * cell's centre. Cells it returns `undefined` for are left out.
	 */
	tally<K>(
		classify: (lon: number, lat: number) => K | undefined,
	): Map<K, number> {
		const cellArea = this.cellSizeM * this.cellSizeM
		const areas = new Map<K, number>()
		for (const [lon, lat] of this.cells()) {
			const key = classify(lon, lat)
			if (key !== undefined) areas.set(key, (areas.get(key) ?? 0) + cellArea)
		}
		return areas
	}

	#latitudeOf(row: number): number {
		return ((row + 0.5) * this.cellSizeM) / this.#yScale
	}
}

// Longitudes beyond ±180° come from projects unwrapped across the antimeridian.
function wrap(lon: number): number {
	return lon - 360 * Math.floor((lon + 180) / 360)
}
