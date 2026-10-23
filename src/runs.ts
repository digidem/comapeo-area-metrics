import { type Grid, WORD } from './grid.ts'

/**
 * Columns `first` to `last` of one row, inclusive.
 */
export type Span = [first: number, last: number]

/**
 * The rows and columns a set of runs spans, inclusive.
 */
export interface Box {
	rowMin: number
	rowMax: number
	colMin: number
	colMax: number
}

/**
 * Cells of a grid as runs along its rows: run `i` is the cells `first[i]` to
 * `last[i]`, inclusive, of row `row[i]`. Runs are sorted by row, then by
 * column. Runs in one row never overlap, but may touch where filled holes
 * were added as runs of their own.
 */
export class Runs {
	readonly row: Int32Array
	readonly first: Int32Array
	readonly last: Int32Array

	constructor(row: Int32Array, first: Int32Array, last: Int32Array) {
		this.row = row
		this.first = first
		this.last = last
	}

	/**
	 * Runs added in order by `add`, which is passed a function to add each.
	 */
	static build(
		add: (push: (row: number, first: number, last: number) => void) => void,
	): Runs {
		const [rows, firsts, lasts]: number[][] = [[], [], []]
		add((row, first, last) => {
			rows.push(row)
			firsts.push(first)
			lasts.push(last)
		})
		return new Runs(
			Int32Array.from(rows),
			Int32Array.from(firsts),
			Int32Array.from(lasts),
		)
	}

	/**
	 * The marked cells of a grid.
	 */
	static fromGrid(grid: Grid): Runs {
		const ascending = (a: number, b: number) => a - b
		return Runs.build((push) => {
			for (const row of [...grid.wordsByRow.keys()].sort(ascending)) {
				const words = grid.wordsByRow.get(row)!
				let first = NaN
				let last = NaN
				for (const word of [...words.keys()].sort(ascending)) {
					const bits = words.get(word)!
					for (let bit = 0; bit < WORD; bit++) {
						if (!(bits & (1 << bit))) continue
						const col = word * WORD + bit
						if (col === last + 1) last = col
						else {
							if (!Number.isNaN(last)) push(row, first, last)
							first = last = col
						}
					}
				}
				if (!Number.isNaN(last)) push(row, first, last)
			}
		})
	}

	get length(): number {
		return this.row.length
	}

	/**
	 * The smallest box holding every run. There must be at least one.
	 */
	bounds(): Box {
		let [colMin, colMax] = [Infinity, -Infinity]
		for (let i = 0; i < this.length; i++) {
			colMin = Math.min(colMin, this.first[i])
			colMax = Math.max(colMax, this.last[i])
		}
		return { rowMin: this.row[0], rowMax: this.row.at(-1)!, colMin, colMax }
	}

	/**
	 * The index of the run covering a cell, or -1 if none does.
	 */
	indexAt(row: number, col: number): number {
		const [start, end] = this.#inRow(row)
		let [lo, hi] = [start, end - 1]
		while (lo <= hi) {
			const mid = (lo + hi) >> 1
			if (this.last[mid] < col) lo = mid + 1
			else if (this.first[mid] > col) hi = mid - 1
			else return mid
		}
		return -1
	}

	/**
	 * The runs in one row, as spans.
	 */
	spansIn(row: number): Span[] {
		const [start, end] = this.#inRow(row)
		const spans: Span[] = []
		for (let i = start; i < end; i++) spans.push([this.first[i], this.last[i]])
		return spans
	}

	// The indices of the runs in `row`, from `start` up to but not including
	// `end`.
	#inRow(row: number): [start: number, end: number] {
		return [this.#firstIndexFrom(row), this.#firstIndexFrom(row + 1)]
	}

	// The index of the first run in `row` or after it.
	#firstIndexFrom(row: number): number {
		let [lo, hi] = [0, this.length]
		while (lo < hi) {
			const mid = (lo + hi) >> 1
			if (this.row[mid] < row) lo = mid + 1
			else hi = mid
		}
		return lo
	}
}

/**
 * Runs grouped into regions connected through the cells' four sides. `ids[i]`
 * is the region of run `i`; ids start at 1 in the order regions are first met
 * going through the runs. `sizes[id]` is a region's size in cells, and
 * `sizes[0]` is unused.
 */
export interface Regions {
	ids: Int32Array
	sizes: number[]
}

/**
 * Finds the connected regions of a set of runs: runs in neighbouring rows that
 * share a column belong to one region.
 */
export function connectedRegions({ row, first, last, length }: Runs): Regions {
	const sets = new DisjointSets(length)
	for (let above = 0, here = 0; here < length;) {
		let end = here
		while (end < length && row[end] === row[here]) end++
		if (here > 0 && row[here - 1] === row[here] - 1) {
			// Walk the two rows' runs left to right, joining those that overlap.
			let [i, j] = [above, here]
			while (i < here && j < end) {
				if (last[i] < first[j]) i++
				else if (last[j] < first[i]) j++
				else {
					sets.union(i, j)
					if (last[i] < last[j]) i++
					else j++
				}
			}
		}
		above = here
		here = end
	}
	const idOfRoot = new Int32Array(length)
	const ids = new Int32Array(length)
	const sizes = [0]
	for (let i = 0; i < length; i++) {
		const root = sets.find(i)
		if (!idOfRoot[root]) idOfRoot[root] = sizes.push(0) - 1
		ids[i] = idOfRoot[root]
		sizes[ids[i]] += last[i] - first[i] + 1
	}
	return { ids, sizes }
}

/**
 * Merges lists of spans, each in column order, into one list in column order
 * in which spans that overlapped or touched are joined.
 */
export function union(...lists: Span[][]): Span[] {
	return lists.reduce(mergeTwo, [])
}

function mergeTwo(a: Span[], b: Span[]): Span[] {
	const merged: Span[] = []
	for (let i = 0, j = 0; i < a.length || j < b.length;) {
		const takeA = j === b.length || (i < a.length && a[i][0] <= b[j][0])
		const [first, last] = takeA ? a[i++] : b[j++]
		const previous = merged.at(-1)
		if (previous && first <= previous[1] + 1)
			previous[1] = Math.max(previous[1], last)
		else merged.push([first, last])
	}
	return merged
}

/**
 * The parts of `spans` outside `holes`. Both must be in column order without
 * overlaps.
 */
export function subtract(spans: Span[], holes: Span[]): Span[] {
	const rest: Span[] = []
	let h = 0
	for (const [first, last] of spans) {
		let start = first
		while (h < holes.length && holes[h][1] < start) h++
		for (let i = h; i < holes.length && holes[i][0] <= last; i++) {
			if (holes[i][0] > start) rest.push([start, holes[i][0] - 1])
			start = holes[i][1] + 1
		}
		if (start <= last) rest.push([start, last])
	}
	return rest
}

/**
 * Union-find over the integers 0 to `size` - 1.
 */
class DisjointSets {
	#parent: Int32Array

	constructor(size: number) {
		this.#parent = Int32Array.from({ length: size }, (_, i) => i)
	}

	find(i: number): number {
		const parent = this.#parent
		while (parent[i] !== i) i = parent[i] = parent[parent[i]]
		return i
	}

	union(a: number, b: number): void {
		const [rootA, rootB] = [this.find(a), this.find(b)]
		if (rootA !== rootB) this.#parent[rootB] = rootA
	}
}
