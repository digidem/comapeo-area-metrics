import { type Grid, simplifyLine } from './grid.ts'
import { checkOption } from './options.ts'
import type { CommonOptions, Point, Position, Records, XY } from './types.ts'

const EARTH_RADIUS_M = 6371008.8
export const DAY_MS = 86400000

/**
 * The points in metres, with the UTC day each was recorded on. The extent's
 * stray rule reads these; lines and implied paths only shape the area.
 */
export interface ProjectedPoints {
	count: number
	xs: Float64Array
	ys: Float64Array
	days: Int32Array
}

/**
 * The points in metres, and the latitude the projection was centred on, or
 * undefined when there were no records to centre it on.
 */
export interface Painted {
	points: ProjectedPoints
	latitude: number | undefined
}

/**
 * Projects each point, implied path and line to metres and paints it onto
 * `grid` with radius `r`. Points are read and stored first, to centre the
 * projection on their median latitude and to join them into implied paths;
 * lines are then painted one at a time as they are read.
 */
export function paintRecords(
	{ points = [], lines = [] }: Records,
	{ impliedPaths = true, latitude }: CommonOptions,
	grid: Grid,
	r: number,
): Painted {
	checkOption(
		latitude === undefined || Math.abs(latitude) < 90,
		'latitude',
		latitude,
		'between -90 and 90',
	)
	const tolerance = grid.cellSize / 2
	const stored = storePoints(points)
	let cut = stored.count ? cutLongitude(stored.lons) : undefined
	if (cut !== undefined)
		for (let i = 0; i < stored.count; i++)
			stored.lons[i] = unwrap(stored.lons[i], cut)
	let centre = latitude ?? medianLatitude(stored)
	let toMetres = centre === undefined ? undefined : metresProjection(centre)
	const projected: ProjectedPoints = {
		count: stored.count,
		xs: new Float64Array(stored.count),
		ys: new Float64Array(stored.count),
		days: Int32Array.from(stored.days),
	}

	if (toMetres) {
		const { xs, ys } = projected
		for (let i = 0; i < stored.count; i++) {
			const xy = toMetres([stored.lons[i], stored.lats[i]])
			xs[i] = xy[0]
			ys[i] = xy[1]
			grid.markDisc(xy, r)
		}
		if (impliedPaths) {
			const { maxGapMinutes = 120, maxDistanceM = 2000 } =
				impliedPaths === true ? {} : impliedPaths
			checkOption(maxGapMinutes >= 0, 'maxGapMinutes', maxGapMinutes, '>= 0')
			checkOption(maxDistanceM >= 0, 'maxDistanceM', maxDistanceM, '>= 0')
			// Each path's vertices are points already painted as discs.
			for (const path of joinPoints(stored, maxGapMinutes, maxDistanceM))
				grid.markBands(
					simplifyLine(
						path.map((i): XY => [xs[i], ys[i]]),
						tolerance,
					),
					r,
				)
		}
	}

	for (const { coordinates } of lines) {
		const xy: XY[] = []
		for (const [lon, lat] of coordinates) {
			if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
			cut ??= lon + 180
			centre ??= lat
			toMetres ??= metresProjection(centre)
			xy.push(toMetres([unwrap(lon, cut), lat]))
		}
		if (xy.length) grid.markLine(simplifyLine(xy, tolerance), r)
	}
	return { points: projected, latitude: centre }
}

/**
 * Points as parallel arrays, for the implied paths. Devices are numbered in
 * order of appearance, so the paths can be sorted on a number rather than a
 * string.
 */
interface StoredPoints {
	count: number
	lons: number[]
	lats: number[]
	times: number[]
	days: number[]
	devices: number[]
}

function storePoints(points: Iterable<Point>): StoredPoints {
	const stored: StoredPoints = {
		count: 0,
		lons: [],
		lats: [],
		times: [],
		days: [],
		devices: [],
	}
	const deviceIds = new Map<string | undefined, number>()
	for (const { coordinates, time, device } of points) {
		const [lon, lat] = coordinates
		if (![lon, lat, time].every(Number.isFinite)) continue
		let id = deviceIds.get(device)
		if (id === undefined) deviceIds.set(device, (id = deviceIds.size))
		stored.lons.push(lon)
		stored.lats.push(lat)
		stored.times.push(time)
		stored.days.push(Math.floor(time / DAY_MS))
		stored.devices.push(id)
		stored.count++
	}
	return stored
}

/**
 * The longitude in the middle of the widest gap between the points, going
 * round the globe. With longitudes counted from there, a project straddling
 * the antimeridian stays in one piece. For any other project the cut falls
 * across ±180° and no longitude changes.
 */
function cutLongitude(lons: number[]): number {
	const sorted = Float64Array.from(lons).sort()
	const last = sorted.length - 1
	let widest = sorted[0] + 360 - sorted[last]
	let cut = sorted[last] + widest / 2
	for (let i = 1; i <= last; i++) {
		const gap = sorted[i] - sorted[i - 1]
		if (gap > widest) [widest, cut] = [gap, sorted[i - 1] + gap / 2]
	}
	return cut
}

/**
 * The longitude moved by 360° if needed to lie in the 360° west of `cut`.
 */
function unwrap(lon: number, cut: number): number {
	if (lon >= cut) return lon - 360
	if (lon < cut - 360) return lon + 360
	return lon
}

/**
 * The median latitude of the points, or undefined when there are none. Unlike
 * a mean, a few far-off points cannot pull it away from where most of the
 * records are.
 */
function medianLatitude({ count, lats }: StoredPoints): number | undefined {
	if (!count) return undefined
	const sorted = Float64Array.from(lats).sort()
	const middle = count >> 1
	return count % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Joins consecutive points from one device on one UTC day into paths of point
 * indices, as long as each is within the gap in time and the distance in space
 * of the one before. Points are sorted by device, day, time and then position,
 * so the paths do not depend on the order the points arrived in.
 */
function joinPoints(
	{ count, lons, lats, times, days, devices }: StoredPoints,
	maxGapMinutes: number,
	maxDistanceM: number,
): number[][] {
	const gapMs = maxGapMinutes * 60 * 1000
	const order = Array.from({ length: count }, (_, i) => i).sort(
		(a, b) =>
			devices[a] - devices[b] ||
			days[a] - days[b] ||
			times[a] - times[b] ||
			lons[a] - lons[b] ||
			lats[a] - lats[b],
	)
	const paths: number[][] = []
	let path: number[] = []
	for (let k = 0; k < order.length; k++) {
		const next = order[k]
		const joined =
			k > 0 &&
			sameRun(order[k - 1], next) &&
			times[next] - times[order[k - 1]] <= gapMs
		if (!joined) {
			if (path.length > 1) paths.push(path)
			path = []
		}
		path.push(next)
	}
	if (path.length > 1) paths.push(path)
	return paths

	function sameRun(previous: number, next: number): boolean {
		return (
			devices[previous] === devices[next] &&
			days[previous] === days[next] &&
			lonLatDistanceM(
				[lons[previous], lats[previous]],
				[lons[next], lats[next]],
			) <= maxDistanceM
		)
	}
}

/**
 * Distance between two positions on a flat earth, accurate enough at the few
 * kilometres an implied path is allowed to span.
 */
function lonLatDistanceM(
	[lon0, lat0]: Position,
	[lon1, lat1]: Position,
): number {
	const meanLat = ((lat0 + lat1) / 2) * (Math.PI / 180)
	const dx =
		(lon1 - lon0) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(meanLat)
	const dy = (lat1 - lat0) * (Math.PI / 180) * EARTH_RADIUS_M
	return Math.hypot(dx, dy)
}

/**
 * An equirectangular projection to metres: degrees of longitude are scaled by
 * the cosine of `latitude`, so distances are right near that latitude.
 */
function metresProjection(latitude: number): (position: Position) => XY {
	const [xScale, yScale] = metresPerDegree(latitude)
	return ([lon, lat]) => [lon * xScale, lat * yScale]
}

/**
 * Metres per degree of longitude and of latitude in the projection centred on
 * `latitude`.
 */
export function metresPerDegree(latitude: number): XY {
	return [
		(EARTH_RADIUS_M * Math.cos((latitude * Math.PI) / 180) * Math.PI) / 180,
		(EARTH_RADIUS_M * Math.PI) / 180,
	]
}
