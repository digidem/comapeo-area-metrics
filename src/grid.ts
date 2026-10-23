import type { XY } from './types.ts'

export const WORD = 32

/**
 * The first and last cell whose centre lies between two coordinates in
 * metres, along either axis.
 */
export function cellsBetween(
	from: number,
	to: number,
	cellSize: number,
): [first: number, last: number] {
	return [Math.ceil(from / cellSize - 0.5), Math.floor(to / cellSize - 0.5)]
}

/**
 * A sparse grid of square cells, one bit per cell, 32 to a word. A cell is
 * marked when its centre, at ((column + 0.5) * cellSize, (row + 0.5) *
 * cellSize), lies inside a shape.
 */
export class Grid {
	cellCount = 0
	readonly wordsByRow = new Map<number, Map<number, number>>()
	readonly cellSize: number

	constructor(cellSize: number) {
		this.cellSize = cellSize
	}

	markDisc([cx, cy]: XY, r: number): void {
		const [first, last] = cellsBetween(cy - r, cy + r, this.cellSize)
		for (let row = first; row <= last; row++) {
			const y = (row + 0.5) * this.cellSize
			const halfChord = Math.sqrt(Math.max(r * r - (y - cy) ** 2, 0))
			this.#markRow(row, cx - halfChord, cx + halfChord)
		}
	}

	markBand([ax, ay]: XY, [bx, by]: XY, r: number): void {
		const length = Math.hypot(bx - ax, by - ay)
		if (length === 0) return
		const [nx, ny] = [((ay - by) / length) * r, ((bx - ax) / length) * r]
		this.#markConvexPolygon([
			[ax + nx, ay + ny],
			[bx + nx, by + ny],
			[bx - nx, by - ny],
			[ax - nx, ay - ny],
		])
	}

	/**
	 * Marks a disc of radius `r` around every vertex and a band of half-width `r`
	 * along every segment.
	 */
	markLine(line: readonly XY[], r: number): void {
		for (const point of line) this.markDisc(point, r)
		this.markBands(line, r)
	}

	/**
	 * Marks a band of half-width `r` along every segment of a line.
	 */
	markBands(line: readonly XY[], r: number): void {
		for (let i = 1; i < line.length; i++) this.markBand(line[i - 1], line[i], r)
	}

	#markConvexPolygon(corners: XY[]): void {
		const ys = corners.map(([, y]) => y)
		const [first, last] = cellsBetween(
			Math.min(...ys),
			Math.max(...ys),
			this.cellSize,
		)
		for (let row = first; row <= last; row++) {
			const y = (row + 0.5) * this.cellSize
			let left = Infinity
			let right = -Infinity
			for (let i = 0; i < corners.length; i++) {
				const [px, py] = corners[i]
				const [qx, qy] = corners[(i + 1) % corners.length]
				// An edge lying along the scanline is skipped: the two edges meeting
				// its ends already give its left and right x.
				if (py === qy || y < Math.min(py, qy) || y > Math.max(py, qy)) continue
				const x = px + ((y - py) / (qy - py)) * (qx - px)
				left = Math.min(left, x)
				right = Math.max(right, x)
			}
			this.#markRow(row, left, right)
		}
	}

	// Marks the cells in `row` whose centre lies within [left, right].
	#markRow(row: number, left: number, right: number): void {
		const [first, last] = cellsBetween(left, right, this.cellSize)
		if (first > last) return
		let words = this.wordsByRow.get(row)
		if (!words) this.wordsByRow.set(row, (words = new Map()))
		for (
			let word = Math.floor(first / WORD);
			word <= Math.floor(last / WORD);
			word++
		) {
			const lo = Math.max(first - word * WORD, 0)
			const hi = Math.min(last - word * WORD, WORD - 1)
			const mask = (-1 << lo) & (-1 >>> (WORD - 1 - hi))
			const bits = words.get(word) ?? 0
			this.cellCount += popcount(mask & ~bits)
			words.set(word, bits | mask)
		}
	}
}

function popcount(bits: number): number {
	bits -= (bits >>> 1) & 0x55555555
	bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333)
	return Math.imul((bits + (bits >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

/**
 * Douglas–Peucker: drops vertices closer than `tolerance` to the simplified
 * line.
 */
export function simplifyLine(line: readonly XY[], tolerance: number): XY[] {
	if (line.length < 3) return line.slice()
	const keep = new Uint8Array(line.length)
	keep[0] = keep[line.length - 1] = 1
	const stack: [first: number, last: number][] = [[0, line.length - 1]]
	while (stack.length) {
		const [first, last] = stack.pop()!
		let farthest = tolerance
		let index = -1
		for (let i = first + 1; i < last; i++) {
			const d = distanceToSegment(line[i], line[first], line[last])
			if (d > farthest) [farthest, index] = [d, i]
		}
		if (index === -1) continue
		keep[index] = 1
		stack.push([first, index], [index, last])
	}
	return line.filter((_, i) => keep[i])
}

function distanceToSegment([px, py]: XY, [ax, ay]: XY, [bx, by]: XY): number {
	const [dx, dy] = [bx - ax, by - ay]
	const lengthSq = dx * dx + dy * dy
	const t = lengthSq
		? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
		: 0
	return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
