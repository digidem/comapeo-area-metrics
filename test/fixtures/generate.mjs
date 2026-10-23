// Regenerates the golden fixtures by running the notebooks' own code cells, so
// the parity tests check src/ against the notebooks.
// Usage: node test/fixtures/generate.mjs (Node 22.18+ or 24, which strip types)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cases, lonLatCases, toLonLat } from './cases.js'

const notebooks = new URL('../../notebooks/', import.meta.url)
const fixtures = new URL('./', import.meta.url)
const dir = mkdtempSync(join(tmpdir(), 'area-metrics-golden-'))

const cellsOf = (name) =>
	[
		...readFileSync(new URL(name, notebooks), 'utf8').matchAll(
			/<script id="\d+" type="([^"]+)"([^>]*)>\n([\s\S]*?)\n {2}<\/script>/g,
		),
	].map(([, type, attributes, body]) => ({
		type,
		pinned: attributes.includes('pinned'),
		code: body.replace(/^ {4}/gm, '').replace(/<\\\//g, '</'),
	}))
const declared = (code) => [
	...new Set(
		[
			...code.matchAll(
				/^(?:async function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
			),
		].map((m) => m[1]),
	),
]
function writeModule(file, prelude, code) {
	const path = join(dir, file)
	writeFileSync(
		path,
		`${prelude}\n${code}\nexport { ${declared(code).join(', ')} };\n`,
	)
	return path
}

// Footprint: the pinned TypeScript cells and the JavaScript cell that defines
// simplifyLine.
const footprintCells = cellsOf('footprint.html').filter(
	(c) =>
		c.pinned &&
		(c.type === 'text/x-typescript' || /^function simplifyLine/m.test(c.code)),
)
const footprintPath = writeModule(
	'footprint.ts',
	'',
	footprintCells.map((c) => c.code).join('\n\n'),
)

// Extent: the pinned TypeScript cells, with the footprint names they import.
const extentPath = writeModule(
	'extent.ts',
	`import { Grid, WORD, cellsOf, simplifyLine } from "./footprint.ts";`,
	cellsOf('extent.html')
		.filter((c) => c.pinned && c.type === 'text/x-typescript')
		.map((c) => c.code)
		.join('\n\n'),
)

// Scenarios: every plain JavaScript cell, for buildRecords and projectRecords,
// plus a stand-in for the one d3 function they use.
const scenarioCode = cellsOf('scenarios.html')
	.filter((c) => c.type === 'module')
	.map((c) => c.code)
	.filter(
		(code) =>
			!/\bview\(|Mutable\(|html`|display\(|scenarioMap|^import |Inputs\./m.test(
				code,
			),
	)
	.join('\n\n')
const scenariosPath = writeModule(
	'scenarios.js',
	`const d3 = { range: (start, stop, step = 1) => (stop === undefined ? [0, start] : [start, stop]).reduce((a, b) => Array.from({ length: Math.max(0, Math.ceil((b - a) / step)) }, (_, i) => a + i * step)) };`,
	scenarioCode,
)

const { calculateFootprint, simplifyLine } = await import(footprintPath)
const { closingExtent } = await import(extentPath)
const { buildRecords, projectRecords } = await import(scenariosPath)

const summary = (extent) => ({
	area: extent.area,
	clusters: extent.clusters.map((c) => ({
		records: c.records,
		days: c.days,
		spanM: c.spanM,
		area: c.area,
		cellCount: c.cellCount,
		kept: c.kept,
		centroid: c.centroid,
	})),
})
const footprintArea = (xyRecords, buffer, cellSize) =>
	calculateFootprint(
		xyRecords.map((r) => simplifyLine(r.xy, cellSize / 2)),
		{ buffer, cellSize },
	).area

const casesGolden = {}
for (const [name, [records, options]] of Object.entries(cases))
	casesGolden[name] = {
		extent: summary(closingExtent(records, options)),
		footprintArea: footprintArea(records, options.linkM / 2, options.cellSize),
		footprintBuffer: options.linkM / 2,
	}

// The notebooks' default controls.
const extentOptions = {
	linkM: 5000,
	marginM: 500,
	maxHoleM2: 25e6,
	cellSize: 100,
	strayKm: 50,
}
const lonLatGolden = lonLatCases.map(({ name, base }) => {
	const { points, lines } = toLonLat(cases[name][0], base)
	const input = {
		points: points.map(({ coordinates: [lon, lat], time, device }) => ({
			lon,
			lat,
			time,
			device,
		})),
		tracks: lines.map(({ coordinates, time }) => ({
			coords: coordinates,
			time,
		})),
	}
	const built = buildRecords(input, { impliedPaths: true })
	const { projection, xyRecords } = projectRecords(built)
	const withoutImplied = projectRecords(
		buildRecords(input, { impliedPaths: false }),
	)
	return {
		name,
		base,
		// The notebooks centre on the mean latitude; the parity tests pass these as
		// the module's latitude option so everything else compares exactly.
		meanLatDeg: projection.meanLatDeg,
		meanLatDegNoImplied: withoutImplied.projection.meanLatDeg,
		impliedCount: built.filter((r) => r.kind === 'implied').length,
		footprintArea: footprintArea(xyRecords, 500, 100),
		footprintAreaNoImplied: footprintArea(withoutImplied.xyRecords, 500, 100),
		extentArea: closingExtent(xyRecords, extentOptions).area,
	}
})

writeFileSync(
	new URL('cases-golden.json', fixtures),
	JSON.stringify(casesGolden, null, 1),
)
writeFileSync(
	new URL('lonlat-golden.json', fixtures),
	JSON.stringify(lonLatGolden, null, 1),
)
rmSync(dir, { recursive: true })
console.log(
	`${Object.keys(casesGolden).length} cases, ${lonLatGolden.length} longitude and latitude cases`,
)
