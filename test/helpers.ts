import { readFileSync } from 'node:fs'

import type { ClosingOptions } from '../src/extent.ts'
import { Grid, simplifyLine } from '../src/grid.ts'
import { DAY_MS, type ProjectedPoints } from '../src/records.ts'
import type { Line, Point, XY } from '../src/types.ts'
import {
	cases as rawCases,
	lonLatCases as rawLonLatCases,
	toLonLat,
} from './fixtures/cases.js'

const fixture = (name: string) =>
	JSON.parse(
		readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
	)

interface RawRecord {
	kind: 'point' | 'track' | 'implied'
	xy: XY[]
	time?: number
}
interface RawOptions {
	linkM: number
	marginM: number
	cellSize: number
	maxHoleM2?: number
	strayKm: number
}
const raw = rawCases as unknown as Record<string, [RawRecord[], RawOptions]>

/**
 * The extent notebook's metre-level cases, painted and summarised the way
 * `measureExtent` does.
 */
export const cases = Object.entries(raw).map(([name, [records, options]]) => {
	const closing: ClosingOptions = {
		linkM: options.linkM,
		marginM: options.marginM,
		maxHoleM2: options.maxHoleM2 ?? 0,
		strayM: options.strayKm * 1000,
	}
	const lines = records.map(({ xy }) => simplifyLine(xy, options.cellSize / 2))
	const paint = (r: number) => {
		const grid = new Grid(options.cellSize)
		for (const line of lines) grid.markLine(line, r)
		return grid
	}
	const pointRecords = records.filter(({ kind }) => kind === 'point')
	const points: ProjectedPoints = {
		count: pointRecords.length,
		xs: Float64Array.from(pointRecords, ({ xy }) => xy[0]![0]),
		ys: Float64Array.from(pointRecords, ({ xy }) => xy[0]![1]),
		days: Int32Array.from(pointRecords, ({ time = 0 }) =>
			Math.floor(time / DAY_MS),
		),
	}
	return { name, paint, points, closing }
})

export interface GoldenExtent {
	area: number
	clusters: {
		records: number
		days: number
		spanM: number
		area: number
		cellCount: number
		kept: boolean
		centroid: XY
	}[]
}

export const casesGolden: Record<
	string,
	{ extent: GoldenExtent; footprintArea: number; footprintBuffer: number }
> = fixture('cases-golden.json')

/**
 * Cases as points and lines in longitude and latitude, with the notebooks'
 * results at their default options.
 */
export const lonLatCases: {
	label: string
	records: { points: Point[]; lines: Line[] }
	golden: {
		meanLatDeg: number
		meanLatDegNoImplied: number
		impliedCount: number
		footprintArea: number
		footprintAreaNoImplied: number
		extentArea: number
	}
}[] = (rawLonLatCases as { name: string; base: [number, number] }[]).map(
	({ name, base }, i) => ({
		label: `${name} at ${base[1]}°`,
		records: toLonLat(raw[name]![0], base),
		golden: fixture('lonlat-golden.json')[i],
	}),
)
