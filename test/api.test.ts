import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
	type Line,
	type Point,
	type Position,
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
const straightLine = (lengthM: number, dx = 0, dy = 0): Line => ({
	coordinates: Array.from(
		{ length: lengthM / 100 + 1 },
		(_, i) => at(dx + i * 100, dy).coordinates,
	),
	time: 0,
})

/**
 * Asserts that `actual` is within half of 10^-digits of `expected`.
 */
function assertClose(actual: number, expected: number, digits: number) {
	assert.ok(
		Math.abs(actual - expected) < 10 ** -digits / 2,
		`${actual} is not within ${10 ** -digits / 2} of ${expected}`,
	)
}

const example = lonLatCases[0]!.records
const measures = [
	['measureFootprint', measureFootprint],
	['measureExtent', measureExtent],
] as const

describe('measureFootprint', () => {
	test('a single point covers about a disc of the buffer', () => {
		const { area } = measureFootprint(
			{ points: [at(0, 0)] },
			{ bufferM: 500, cellSizeM: 10 },
		)
		assertClose(area / (Math.PI * 500 ** 2), 1, 2)
	})

	test('a straight line covers about a pill of the buffer', () => {
		const { area } = measureFootprint(
			{ lines: [straightLine(10000)] },
			{ bufferM: 200, cellSizeM: 10 },
		)
		assertClose(area / (10000 * 400 + Math.PI * 200 ** 2), 1, 2)
	})
})

describe('implied paths', () => {
	// Two points 1.5 km apart, 30 minutes apart: joined by default
	const points = [at(0, 0, 0), at(1500, 0, 30 * 60 * 1000)]
	const options = { bufferM: 100, cellSizeM: 10 }
	const apart = measureFootprint(
		{ points },
		{ ...options, impliedPaths: false },
	).area

	test('join close points from one device', () => {
		const joined = measureFootprint({ points }, options).area
		assertClose(joined - apart, 1500 * 200 - Math.PI * 100 ** 2, -3)
	})

	test('are limited by distance and gap', () => {
		for (const impliedPaths of [{ maxDistanceM: 1000 }, { maxGapMinutes: 20 }])
			assert.equal(
				measureFootprint({ points }, { ...options, impliedPaths }).area,
				apart,
			)
	})

	test('skip points without a finite time', () => {
		const untimed = { coordinates: at(5000, 0).coordinates, time: NaN }
		assert.equal(
			measureFootprint({ points: [...points, untimed] }, options).area,
			measureFootprint({ points }, options).area,
		)
	})

	test('never join different devices or days', () => {
		const devices = [at(0, 0, 0, 'a'), at(1500, 0, 1000, 'b')]
		const days = [at(0, 0, DAY - 1000), at(1500, 0, DAY + 1000)]
		for (const points of [devices, days])
			assert.equal(measureFootprint({ points }, options).area, apart)
	})
})

describe('options', () => {
	const records = { points: [at(0, 0)] }
	test('reject values that would hang or mean nothing', () => {
		for (const options of [
			{ cellSizeM: 0 },
			{ cellSizeM: -100 },
			{ cellSizeM: 600 },
			{ bufferM: 0 },
			{ bufferM: Infinity },
			{ bufferM: 1e6, cellSizeM: 100 },
			{ latitude: NaN },
			{ latitude: 90 },
			{ impliedPaths: { maxGapMinutes: NaN } },
		])
			assert.throws(() => measureFootprint(records, options), RangeError)
		for (const options of [
			{ cellSizeM: Infinity },
			{ linkingDistanceM: Infinity },
			{ marginM: -1 },
			{ maxHoleAreaM2: NaN },
			{ strayDistanceM: -1 },
		])
			assert.throws(() => measureExtent(records, options), RangeError)
	})

	test('allow infinite limits', () => {
		const options = { maxHoleAreaM2: Infinity, strayDistanceM: Infinity }
		assert.ok(measureExtent(records, options).area > 0)
	})
})

describe('across the antimeridian', () => {
	// Two days of walking from `lon` eastwards, in GeoJSON's -180 to 180
	const walk = (lon: number): Point[] =>
		Array.from({ length: 20 }, (_, i) => {
			const east = lon + (i % 10) * 0.01
			return {
				coordinates: [east > 180 ? east - 360 : east, -17 + (i > 9 ? 0.01 : 0)],
				time: (i > 9 ? DAY : 0) + (i % 10) * 600000,
			}
		})
	for (const [name, measure] of measures)
		test(`${name} measures the same as anywhere else`, () => {
			const across = measure({ points: walk(179.95) }, { latitude: -17 }).area
			const elsewhere = measure({ points: walk(9.95) }, { latitude: -17 }).area
			assertClose(across / elsewhere, 1, 2)
		})
})

describe('measureExtent', () => {
	const territory = Array.from({ length: 40 }, (_, i) =>
		at((i % 8) * 1500, Math.floor(i / 8) * 1500, i * DAY),
	)
	const training = (km: number) => [
		at(km * 1000, 0, 0, 'b'),
		at(km * 1000 + 200, 0, 0, 'c'),
	]
	// Fixed so the extra points cannot shift the grid's alignment
	const options = { latitude: -3 }
	const alone = measureExtent({ points: territory }, options).area

	test('drops a far-off cluster recorded on one day', () => {
		const points = [...territory, ...training(80)]
		assert.equal(measureExtent({ points }, options).area, alone)
		assert.ok(
			measureExtent({ points }, { ...options, strayDistanceM: 100000 }).area >
				alone,
		)
	})

	test('keeps a cluster within the stray distance', () => {
		const points = [...territory, ...training(30)]
		assert.ok(measureExtent({ points }, options).area > alone)
	})

	test('drops a far-off cluster with only lines', () => {
		const lines = [straightLine(5000, 80000, 0)]
		assert.equal(
			measureExtent({ points: territory, lines }, options).area,
			alone,
		)
	})

	test('without points, keeps the biggest cluster and drops far ones', () => {
		const big = [0, 1500, 3000, 4500].map((dy) => straightLine(10000, 0, dy))
		const bigAlone = measureExtent({ lines: big }, options).area
		// West of the big cluster, so a tie broken on position alone would pick it
		const far = straightLine(500, -80000, 0)
		assert.equal(
			measureExtent({ lines: [far, ...big] }, options).area,
			bigAlone,
		)
	})

	test('a very long track costs only the cells it covers', () => {
		// 1000 km diagonally: the box around it would be 50 M cells
		const track: Line = {
			coordinates: Array.from(
				{ length: 1001 },
				(_, i) => at(i * 707, i * 707).coordinates,
			),
			time: 0,
		}
		const started = performance.now()
		const { area } = measureExtent({ lines: [track] })
		assert.ok(performance.now() - started < 5000)
		assertClose(area / (1e6 * 1000 + Math.PI * 500 ** 2), 1, 1)
	})

	test('records far apart are measured quickly', () => {
		// 2,000 km apart: a box over both would be 400 M cells
		const started = performance.now()
		const { area } = measureExtent(
			{ points: [...territory, at(2e6, 2e6, 0, 'b')] },
			options,
		)
		assert.ok(performance.now() - started < 5000)
		assert.equal(area, alone)
	})
})

for (const [name, measure] of measures)
	describe(`${name} input`, () => {
		const expected = measure(example).area

		test('no records has no area', () => {
			for (const records of [{}, { points: [], lines: [] }]) {
				const { area, coverage } = measure(records)
				assert.equal(area, 0)
				assert.equal(coverage.area, 0)
				assert.deepEqual([...coverage.runs()], [])
			}
		})

		test('does not depend on record order', () => {
			const reversed = {
				points: [...example.points].reverse(),
				lines: [...example.lines].reverse(),
			}
			assert.equal(measure(reversed).area, expected)
		})

		test('reads one-shot iterables once, with lazy coordinates', () => {
			const reads = { points: 0, lines: 0 }
			const streamed = {
				points: (function* () {
					reads.points++
					yield* example.points
				})(),
				lines: (function* () {
					reads.lines++
					for (const { coordinates, time } of example.lines)
						yield {
							time,
							coordinates: (function* () {
								yield* coordinates
							})(),
						}
				})(),
			}
			assert.equal(measure(streamed).area, expected)
			assert.deepEqual(reads, { points: 1, lines: 1 })
		})

		test('skips positions without finite coordinates', () => {
			const withGaps = {
				points: [
					...example.points,
					{ coordinates: [Number.NaN, 0] as Position, time: 0 },
				],
				lines: [
					...example.lines.map(({ coordinates, time }) => ({
						time,
						coordinates: [...coordinates, [Infinity, 0] as Position],
					})),
					{ coordinates: [], time: 0 },
				],
			}
			assert.equal(measure(withGaps).area, expected)
		})

		test('is centred on the median latitude of the points', () => {
			// Five points at 60°N and two far south: a mean would sit near 43°
			const points: Point[] = [
				...[0, 1, 2, 3, 4].map((i) => ({
					coordinates: [10 + i * 0.01, 60] as Position,
					time: 0,
				})),
				...[0, 1].map((i) => ({
					coordinates: [10 + i, 0] as Position,
					time: 0,
				})),
			]
			const lines = [straightLine(5000)]
			assert.equal(
				measure({ points, lines }).area,
				measure({ points, lines }, { latitude: 60 }).area,
			)
		})

		test('without points, is centred on the first line', () => {
			const lines = [straightLine(5000)]
			assert.equal(
				measure({ lines }).area,
				measure({ lines }, { latitude: -3 }).area,
			)
		})
	})
