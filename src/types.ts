/**
 * Longitude then latitude in degrees, as in GeoJSON.
 */
export type Position = [lon: number, lat: number]

/**
 * Projected coordinates in metres.
 */
export type XY = [x: number, y: number]

/**
 * A single position, such as an observation. Skipped if its coordinates or
 * time are not finite.
 */
export interface Point {
	coordinates: Position
	/** Milliseconds since the epoch. */
	time: number
	/**
	 * Points are only joined into implied paths with others from the same
	 * device. Points without a device are all treated as one device.
	 */
	device?: string | undefined
}

/**
 * A sequence of positions, such as a track. Positions whose coordinates are
 * not finite are skipped.
 */
export interface Line {
	coordinates: Iterable<Position>
	/**
	 * Milliseconds since the epoch, at the start of the line. Not read at
	 * present: only points count towards the extent's stray rule.
	 */
	time: number
}

/**
 * The records to measure. Each iterable is read once, points first, so either
 * can be a one-shot generator streaming rows from a database.
 */
export interface Records {
	points?: Iterable<Point> | undefined
	lines?: Iterable<Line> | undefined
}

export interface ImpliedPathOptions {
	/** Defaults to 120. */
	maxGapMinutes?: number | undefined
	/** Defaults to 2000. */
	maxDistanceM?: number | undefined
}

/**
 * `true` (the default) joins points with the default limits; `false` turns
 * implied paths off.
 */
export type ImpliedPaths = boolean | ImpliedPathOptions

export interface CommonOptions {
	impliedPaths?: ImpliedPaths | undefined
	/**
	 * The latitude the projection to metres is centred on. Defaults to the
	 * median latitude of the points, or the first line's first latitude when
	 * there are none. Fixing it keeps the grid's alignment, and so the area,
	 * steady as records are added.
	 */
	latitude?: number | undefined
}
