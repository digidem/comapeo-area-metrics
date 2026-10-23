import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { closingExtent } from '../src/extent.ts'
import { measureExtent, measureFootprint } from '../src/index.ts'
import { cases, casesGolden, lonLatCases } from './helpers.ts'

// The notebook counts tracks towards the stray rule and the module only points,
// so the clusters' shapes are compared exactly but which ones are kept is not.
describe('matches the extent notebook on its verification cases', () => {
	const byPlace = (a: { centroid: number[] }, b: { centroid: number[] }) =>
		a.centroid[0]! - b.centroid[0]! || a.centroid[1]! - b.centroid[1]!
	for (const { name, paint, points, closing } of cases)
		test(name, () => {
			const { extent } = casesGolden[name]!
			const { clusters } = closingExtent(
				paint(closing.linkM / 2),
				points,
				closing,
			)
			assert.deepEqual(
				clusters
					.map(({ cellCount, area, centroid }) => ({
						cellCount,
						area,
						centroid,
					}))
					.sort(byPlace),
				extent.clusters
					.map(({ cellCount, area, centroid }) => ({
						cellCount,
						area,
						centroid,
					}))
					.sort(byPlace),
			)
		})
})

describe('matches the footprint notebook on the extent cases', () => {
	for (const { name, paint } of cases)
		test(name, () => {
			const { footprintArea, footprintBuffer } = casesGolden[name]!
			const grid = paint(footprintBuffer)
			assert.equal(grid.cellCount * grid.cellSize ** 2, footprintArea)
		})
})

// The module centres the projection on the median latitude where the notebooks
// take the mean, so each case passes the notebooks' centre as `latitude`.
describe('matches the notebooks in longitude and latitude', () => {
	for (const { label, records, golden } of lonLatCases)
		test(label, () => {
			assert.ok(golden.impliedCount > 0)
			const latitude = golden.meanLatDeg
			assert.equal(
				measureFootprint(records, { latitude }).area,
				golden.footprintArea,
			)
			assert.equal(
				measureFootprint(records, {
					latitude: golden.meanLatDegNoImplied,
					impliedPaths: false,
				}).area,
				golden.footprintAreaNoImplied,
			)
			assert.equal(measureExtent(records, { latitude }).area, golden.extentArea)
		})
})
