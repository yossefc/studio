/**
 * Shared constants used across AI flows and validation logic.
 */

/** Minimum ratio of Hebrew characters required for output validation. */
export const HEBREW_RATIO_THRESHOLD = 0.7;

/** Maximum number of chunks to process per study guide generation. */
export const MAX_CHUNKS_PER_GUIDE = 30;

/** Maximum number of chunks to process per individual source. */
export const MAX_CHUNKS_PER_SOURCE = 8;

/** Frequency of cancellation checks (every N chunks). */
export const CANCELLATION_CHECK_INTERVAL = 3;

/** Maximum number of successful guide generations per user, per calendar month. */
export const MAX_MONTHLY_GENERATIONS = 30;

/** Progress units reserved for the summary stage. */
export const SUMMARY_PROGRESS_UNITS = 1;

/** Rate limit window for guide generation and export actions. */
export const ACTION_RATE_LIMIT_WINDOW_SECONDS = 60;

/** Maximum generation attempts per user within the rate limit window. */
export const GENERATION_RATE_LIMIT_USER_MAX = 2;

/** Maximum generation attempts per IP within the rate limit window. */
export const GENERATION_RATE_LIMIT_IP_MAX = 5;

/** Maximum Google Docs exports per user within the rate limit window. */
export const EXPORT_RATE_LIMIT_USER_MAX = 5;

/** Maximum Google Docs exports per IP within the rate limit window. */
export const EXPORT_RATE_LIMIT_IP_MAX = 10;
