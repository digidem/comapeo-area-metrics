import { Coverage } from './coverage.ts'
import { Grid } from './grid.ts'
import { checkCellSize } from './options.ts'
import { paintRecords } from './records.ts'
import { Runs } from './runs.ts'
import type { CommonOptions, Records } from './types.ts'

export interface FootprintOptions extends CommonOptions {
	/**
	 * How far around each record the team is assumed to have seen. Defaults to
	 * 500.
	 */
	bufferM?: number | undefined
	/** Defaults to `bufferM / 5`. */
	cellSizeM?: number | undefined
}

export interface Footprint {
	/** Square metres. */
	area: number
	/** The ground the footprint covers. */
	coverage: Coverage
}

/**
 * The area within `bufferM` of any point, line or implied path.
 */
export function measureFootprint(
	records: Records,
	{ bufferM = 500, cellSizeM = bufferM / 5, ...options }: FootprintOptions = {},
): Footprint {
	checkCellSize(cellSizeM, bufferM, 'bufferM')
	const grid = new Grid(cellSizeM)
	const { latitude } = paintRecords(records, options, grid, bufferM)
	const coverage = new Coverage(Runs.fromGrid(grid), cellSizeM, latitude ?? 0)
	return { area: coverage.area, coverage }
}
