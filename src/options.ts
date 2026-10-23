/**
 * The most cells a disc painted around a record may reach across, in each
 * direction. Beyond it, one point would paint millions of cells.
 */
const MAX_RADIUS_CELLS = 1000

/**
 * Throws a RangeError saying what `name` must be, unless `valid`.
 */
export function checkOption(
	valid: boolean,
	name: string,
	value: unknown,
	must: string,
): void {
	if (!valid) throw new RangeError(`${name} must be ${must}, not ${value}`)
}

/**
 * Checks the cell size against the radius records are painted with: no
 * larger than it, so every point covers its own cell, and no more than
 * `MAX_RADIUS_CELLS` times smaller.
 */
export function checkCellSize(
	cellSizeM: number,
	radius: number,
	radiusName: string,
): void {
	checkOption(
		Number.isFinite(cellSizeM) && cellSizeM > 0 && cellSizeM <= radius,
		'cellSizeM',
		cellSizeM,
		`greater than 0 and at most ${radiusName}`,
	)
	checkOption(
		radius <= cellSizeM * MAX_RADIUS_CELLS,
		radiusName,
		radius,
		`at most ${MAX_RADIUS_CELLS} times cellSizeM`,
	)
}
