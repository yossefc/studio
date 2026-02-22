/**
 * @fileOverview Helper for estimating AI costs and tracking performance metrics.
 */

export interface UsageMetrics {
  modelName: string;
  chunkCount: number;
  durationMs: number;
  cacheHits: number;
}

/**
 * Estimates the cost of a generation session in USD.
 * Accounts for both input (prompt + source) and output (explanation) tokens.
 * Pricing (Approximate per million tokens):
 * - Gemini 3.5 Pro: $8 input / $16 output
 * - Gemini 3.1 Pro: $6 input / $12 output
 * - Gemini 2.5 Pro: $5.5 input / $11 output
 */
export function estimateCost(metrics: UsageMetrics): number {
  const model = metrics.modelName.toLowerCase();
  const generatedChunks = Math.max(metrics.chunkCount - metrics.cacheHits, 0);

  // Estimate: ~200 input tokens (prompt template + source) + ~300 output tokens per chunk.
  const inputTokens = generatedChunks * 200;
  const outputTokens = generatedChunks * 300;

  let inputRate = 8.0;
  let outputRate = 16.0;
  if (model.includes('3.1-pro')) {
    inputRate = 6.0;
    outputRate = 12.0;
  } else if (model.includes('2.5-pro')) {
    inputRate = 5.5;
    outputRate = 11.0;
  }

  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

export function logGenerationMetrics(metrics: UsageMetrics) {
  const cost = estimateCost(metrics);
  const safeChunkCount = Math.max(metrics.chunkCount, 1);
  console.info('[TalmudAI-Metrics]', {
    ...metrics,
    estimatedCostUsd: cost.toFixed(6),
    avgMsPerChunk: (metrics.durationMs / safeChunkCount).toFixed(0),
  });
}
