// Synthetic record sets in metres with closingExtent options, copied from the
// extent notebook's verification harness. cases-golden.json holds the
// notebook's results for them.
let s = 12345
const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
const DAY = 86400000

function points(cx, cy, spread, n, dayFrom, dayCount) {
	return Array.from({ length: n }, () => ({
		kind: 'point',
		xy: [[cx + (rand() - 0.5) * spread, cy + (rand() - 0.5) * spread]],
		time: (dayFrom + Math.floor(rand() * dayCount)) * DAY + rand() * DAY,
	}))
}

function track(from, to, n, day) {
	const xy = []
	for (let i = 0; i <= n; i++) {
		const t = i / n
		xy.push([
			from[0] + (to[0] - from[0]) * t + (rand() - 0.5) * 300,
			from[1] + (to[1] - from[1]) * t + (rand() - 0.5) * 300,
		])
	}
	return { kind: 'track', xy, time: day * DAY }
}

const main = [
	...points(20000, 20000, 12000, 120, 0, 30),
	track([14000, 14000], [26000, 26000], 80, 3),
	track([14000, 26000], [26000, 14000], 80, 7),
	...Array.from({ length: 14 }, (_, i) => ({
		kind: 'point',
		xy: [
			[
				40000 + 6000 * Math.cos((i / 14) * 2 * Math.PI),
				20000 + 6000 * Math.sin((i / 14) * 2 * Math.PI),
			],
		],
		time: (10 + i) * DAY,
	})),
	{
		kind: 'implied',
		xy: [
			[20000, 20000],
			[22000, 21000],
		],
		time: 5 * DAY,
	},
]
const stray1 = points(120000, 20000, 400, 5, 40, 1)
const site2 = points(120000, 90000, 3000, 30, 40, 10)
const venue = points(20000, 120000, 200, 12, 0, 300)
const lone = [{ kind: 'point', xy: [[20000, -80000]], time: 1 * DAY }]
const records = [...main, ...stray1, ...site2, ...venue, ...lone]

// A busy territory: thousands of records over 50 km, many holes between them.
const territory = [
	...points(30000, 30000, 50000, 3000, 0, 400),
	...Array.from({ length: 30 }, (_, i) =>
		track(
			[5000 + rand() * 50000, 5000 + rand() * 50000],
			[5000 + rand() * 50000, 5000 + rand() * 50000],
			60,
			i * 7,
		),
	),
	...points(100000, 30000, 2000, 8, 100, 2),
]

const figureRecords = (() => {
	const ringAt = ([cx, cy], radius, count) =>
		Array.from({ length: count }, (_, i) => {
			const angle = (i / count) * 2 * Math.PI
			return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
		})
	const arms = [0.45, -0.45].flatMap((bend) =>
		Array.from({ length: 8 }, (_, i) => [2.6 + i * 0.45, bend * i * 0.45]),
	)
	return [...ringAt([-2.4, 0], 0.4, 8), ...ringAt([0, 0], 1, 12), ...arms].map(
		(xy) => ({ kind: 'point', xy: [xy] }),
	)
})()
const figureOptions = { linkM: 1.5, cellSize: 0.02, strayKm: Infinity }

export const cases = {
	default: [
		records,
		{ linkM: 5000, marginM: 500, cellSize: 100, maxHoleM2: 25e6, strayKm: 50 },
	],
	bigHoles: [
		records,
		{ linkM: 5000, marginM: 250, cellSize: 100, maxHoleM2: 400e6, strayKm: 50 },
	],
	noHoles: [
		records,
		{ linkM: 5000, marginM: 0, cellSize: 200, maxHoleM2: 0, strayKm: 50 },
	],
	farStray: [
		records,
		{ linkM: 3000, marginM: 500, cellSize: 100, maxHoleM2: 25e6, strayKm: 300 },
	],
	coarse: [
		records,
		{ linkM: 10000, marginM: 1000, cellSize: 500, strayKm: 10 },
	],
	empty: [
		[],
		{ linkM: 5000, marginM: 500, cellSize: 100, maxHoleM2: 25e6, strayKm: 50 },
	],
	territory: [
		territory,
		{ linkM: 3000, marginM: 300, cellSize: 100, maxHoleM2: 10e6, strayKm: 30 },
	],
	fine: [
		territory,
		{ linkM: 3000, marginM: 300, cellSize: 50, maxHoleM2: 10e6, strayKm: 30 },
	],
	fig1: [figureRecords, { ...figureOptions, marginM: 0 }],
	fig3: [figureRecords, { ...figureOptions, marginM: 0.15 }],
	fig4: [figureRecords, { ...figureOptions, marginM: 0.15, maxHoleM2: 4 }],
}

// Loops of records at 2 km spacing around a rectangle, for the hole rule:
// measured on the raster, the thin loop's 350 km² hole and the square's 400 km²
// hole both exceed their limits, so neither is filled.
const loop = (w, h, spacing) => {
	const xy = []
	for (let x = 0; x <= w; x += spacing) xy.push([x, 0], [x, h])
	for (let y = spacing; y < h; y += spacing) xy.push([0, y], [w, y])
	return xy.map(([x, y]) => ({ kind: 'point', xy: [[x + 50000, y + 50000]] }))
}
const loopOptions = { linkM: 5000, marginM: 500, cellSize: 100, strayKm: 50 }
Object.assign(cases, {
	loopThin: [loop(50000, 7000, 2000), { ...loopOptions, maxHoleM2: 250e6 }],
	loopSquare: [loop(20000, 20000, 2000), { ...loopOptions, maxHoleM2: 390e6 }],
	// A lone point inside the thin loop's hole: its box lies inside the loop's,
	// so the two must share a frame.
	loopInside: [
		[
			...loop(50000, 7000, 2000),
			{ kind: 'point', xy: [[75000, 53500]], time: 9 * DAY },
		],
		{ ...loopOptions, maxHoleM2: 250e6 },
	],
	loopFilled: [loop(20000, 10000, 2000), { ...loopOptions, maxHoleM2: 250e6 }],
})

const EARTH_RADIUS_M = 6371008.8
const DEVICES = ['a', 'b', 'c']

/**
 * A case's records as points and lines in longitude and latitude
 * about a base point, devices assigned in turn so some points join into
 * implied paths. Implied records are dropped.
 */
export function toLonLat(records, [lon0, lat0]) {
	const toLonLat = ([x, y]) => [
		lon0 +
			(x / (EARTH_RADIUS_M * Math.cos((lat0 * Math.PI) / 180))) *
				(180 / Math.PI),
		lat0 + (y / EARTH_RADIUS_M) * (180 / Math.PI),
	]
	const points = []
	const lines = []
	records.forEach(({ kind, xy, time = 0 }, i) => {
		if (kind === 'point')
			points.push({
				coordinates: toLonLat(xy[0]),
				time,
				device: DEVICES[i % 3],
			})
		else if (kind === 'track')
			lines.push({ coordinates: xy.map(toLonLat), time })
	})
	return { points, lines }
}

/**
 * The cases, and the base points they are shifted to, that lonlat-golden.json
 * holds the notebooks' results for.
 */
export const lonLatCases = ['default', 'territory', 'loopInside'].flatMap(
	(name) => [
		{ name, base: [-62.2, -3.5] },
		{ name, base: [10, 60] },
	],
)
