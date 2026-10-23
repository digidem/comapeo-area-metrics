import { measureExtent, measureFootprint } from '../src/index.ts'
import { lonLatCases } from '../test/helpers.ts'

const RUNS = 20

/**
 * Median wall time of `RUNS` calls after two warm-up calls, in milliseconds.
 */
function time(fn: () => unknown): number {
	fn()
	fn()
	const times = Array.from({ length: RUNS }, () => {
		const started = performance.now()
		fn()
		return performance.now() - started
	}).sort((a, b) => a - b)
	return times[RUNS >> 1]!
}

for (const { label, records } of lonLatCases) {
	const footprint = time(() => measureFootprint(records))
	const extent = time(() => measureExtent(records))
	const { coverage } = measureFootprint(records)
	const tally = time(() => coverage.tally((lon) => lon < -62.2))
	console.log(
		`${label.padEnd(20)} footprint ${footprint.toFixed(1).padStart(6)} ms   extent ${extent.toFixed(1).padStart(6)} ms   footprint tally ${tally.toFixed(1).padStart(6)} ms`,
	)
}
