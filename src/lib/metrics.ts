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
 * Pricing (Approximate per million tokens, as of 2025):
 * - Gemini 2.5 Pro:        $1.25 input / $10.00 output
 * - Gemini 2.5 Flash:      $0.15 input / $0.60 output
 * - Gemini 2.5 Flash-Lite: $0.075 input / $0.30 output
 */
export function estimateCost(metrics: UsageMetrics): number {
  const model = metrics.modelName.toLowerCase();
  const generatedChunks = Math.max(metrics.chunkCount - metrics.cacheHits, 0);

  // Estimate: ~2000 input tokens (prompt + context + source text) + ~1000 output tokens per chunk.
  const inputTokens = generatedChunks * 2000;
  const outputTokens = generatedChunks * 1000;

  let inputRate = 1.25;
  let outputRate = 10.0;
  if (model.includes('flash-lite')) {
    inputRate = 0.075;
    outputRate = 0.30;
  } else if (model.includes('flash')) {
    inputRate = 0.15;
    outputRate = 0.60;
  } else if (model.includes('2.5-pro')) {
    inputRate = 1.25;
    outputRate = 10.0;
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
