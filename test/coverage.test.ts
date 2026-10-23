import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
	type CoverageRun,
	type Point,
	measureExtent,
	measureFootprint,
} from '../src/index.ts'
import { lonLatCases } from './helpers.ts'

const DAY = 86400000
// One degree of latitude, in metres, near the equator
const DEG_M = 111195
const at = (dx: number, dy: number, time = 0, device = 'a'): Point => ({
	coordinates: [-62 + dx / DEG_M, -3 + dy / DEG_M],
	time,
	device,
})
const measures = [
	['measureFootprint', measureFootprint],
	['measureExtent', measureExtent],
] as const

for (const [name, measure] of measures)
	describe(`${name} coverage`, () => {
		for (const { label, records } of lonLatCases)
			test(`${label}: runs add up to the area and never touch`, () => {
				const { area, coverage } = measure(records)
				assert.equal(coverage.area, area)
				let sum = 0
				let previous: CoverageRun | undefined
				for (const run of coverage.runs()) {
					sum += run.areaM2
					assert.ok(run.lon0 < run.lon1)
					if (previous && previous.lat === run.lat)
						assert.ok(run.lon0 > previous.lon1)
					else if (previous) assert.ok(run.lat > previous.lat)
					previous = run
				}
				assert.equal(sum, area)
			})

		const { records } = lonLatCases[0]!
		const { area, coverage } = measure(records)
		const cellArea = coverage.cellSizeM ** 2

		test('has one cell centre per cell', () => {
			assert.equal([...coverage.cells()].length * cellArea, area)
		})

		test('tallies area by class, leaving out undefined', () => {
			assert.deepEqual(
				coverage.tally(() => 'all'),
				new Map([['all', area]]),
			)
			assert.equal(coverage.tally(() => undefined).size, 0)
			const lats = [...coverage.cells()]
				.map(([, lat]) => lat)
				.sort((a, b) => a - b)
			const split = (line: number) =>
				coverage.tally((_, lat) => (lat < line ? 'south' : 'north'))
			const middle = split(lats[lats.length >> 1]!)
			assert.equal(middle.get('south')! + middle.get('north')!, area)
			const higher = split(lats[(lats.length * 3) >> 2]!)
			assert.ok(higher.get('south')! > middle.get('south')!)
		})

		test('wraps longitudes across the antimeridian', () => {
			// Two days of walking from 179.95°E eastwards across 180°
			const points = Array.from({ length: 20 }, (_, i): Point => {
				const east = 179.95 + (i % 10) * 0.01
				return {
					coordinates: [
						east > 180 ? east - 360 : east,
						-17 + (i > 9 ? 0.01 : 0),
					],
					time: (i > 9 ? DAY : 0) + (i % 10) * 600000,
				}
			})
			const { area, coverage } = measure({ points })
			const runs = [...coverage.runs()]
			for (const { lon0, lon1 } of runs)
				assert.ok(-180 <= lon0 && lon0 < lon1 && lon1 <= 180)
			assert.ok(runs.some(({ lon1 }) => lon1 === 180))
			assert.ok(runs.some(({ lon0 }) => lon0 === -180))
			const sum = runs.reduce((total, run) => total + run.areaM2, 0)
			assert.ok(Math.abs(sum / area - 1) < 1e-9)
			for (const [lon] of coverage.cells()) assert.ok(-180 <= lon && lon < 180)
		})
	})

describe('footprint coverage', () => {
	test('holds the cells whose centres lie within the buffer', () => {
		const { coverage } = measureFootprint(
			{ points: [at(0, 0)] },
			{ bufferM: 500, cellSizeM: 10 },
		)
		const xScale = DEG_M * Math.cos((-3 * Math.PI) / 180)
		for (const [lon, lat] of coverage.cells())
			assert.ok(Math.hypot((lon + 62) * xScale, (lat + 3) * DEG_M) <= 500 + 1)
	})
})

describe('extent coverage', () => {
	const territory = Array.from({ length: 40 }, (_, i) =>
		at((i % 8) * 1500, Math.floor(i / 8) * 1500, i * DAY),
	)
	const training = [at(80000, 0, 0, 'b'), at(80200, 0, 0, 'c')]
	const farEast = (lon: number) => (lon > -62 + 40000 / DEG_M ? 'far' : 'near')

	test('joins filled holes to the runs around them', () => {
		// A ring of points 8 km across, which leaves a hole after growing
		const ring = Array.from({ length: 24 }, (_, i) => {
			const angle = (i / 24) * 2 * Math.PI
			return at(4000 * Math.cos(angle), 4000 * Math.sin(angle), i * DAY)
		})
		const options = { latitude: -3, maxHoleAreaM2: Infinity }
		const { coverage } = measureExtent({ points: ring }, options)
		const open = measureExtent(
			{ points: ring },
			{ ...options, maxHoleAreaM2: 0 },
		)
		assert.ok(coverage.area > open.coverage.area)
		const runs = [...coverage.runs()]
		for (let i = 1; i < runs.length; i++)
			if (runs[i]!.lat === runs[i - 1]!.lat)
				assert.ok(runs[i]!.lon0 > runs[i - 1]!.lon1)
	})

	test('leaves out dropped strays', () => {
		const points = [...territory, ...training]
		const options = { latitude: -3 }
		const { area, coverage } = measureExtent({ points }, options)
		assert.deepEqual(coverage.tally(farEast), new Map([['near', area]]))
		const kept = measureExtent({ points }, { ...options, strayDistanceM: 1e5 })
		assert.ok(kept.coverage.tally(farEast).get('far')! > 0)
	})
})
