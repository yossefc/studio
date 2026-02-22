/**
 * Shared constants used across AI flows and validation logic.
 */

/** Minimum ratio of Hebrew characters required for output validation. */
export const HEBREW_RATIO_THRESHOLD = 0.7;

/** Maximum number of chunks to process per study guide generation. */
export const MAX_CHUNKS_PER_GUIDE = 30;

/** Maximum number of chunks to process per individual source. */
export const MAX_CHUNKS_PER_SOURCE = 15;

/** Frequency of cancellation checks (every N chunks). */
export const CANCELLATION_CHECK_INTERVAL = 3;
