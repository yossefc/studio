export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageMetrics extends UsageSnapshot {
  modelName: string;
  chunkCount: number;
  durationMs: number;
  cacheHits: number;
  estimatedCostUsd?: number;
}

const TOKEN_PRICING_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  'googleai/gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'googleai/gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'googleai/gemini-2.5-pro': { input: 1.25, output: 10 },
};

export function normalizeUsage(usage?: Partial<UsageSnapshot> | null): UsageSnapshot {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? (inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function addUsage(
  left?: Partial<UsageSnapshot> | null,
  right?: Partial<UsageSnapshot> | null,
): UsageSnapshot {
  const normalizedLeft = normalizeUsage(left);
  const normalizedRight = normalizeUsage(right);

  return {
    inputTokens: normalizedLeft.inputTokens + normalizedRight.inputTokens,
    outputTokens: normalizedLeft.outputTokens + normalizedRight.outputTokens,
    totalTokens: normalizedLeft.totalTokens + normalizedRight.totalTokens,
  };
}

function getPricing(modelName: string): { input: number; output: number } {
  if (TOKEN_PRICING_USD_PER_MILLION[modelName]) {
    return TOKEN_PRICING_USD_PER_MILLION[modelName];
  }

  if (modelName.includes('flash-lite')) {
    return TOKEN_PRICING_USD_PER_MILLION['googleai/gemini-2.5-flash-lite'];
  }

  if (modelName.includes('flash')) {
    return TOKEN_PRICING_USD_PER_MILLION['googleai/gemini-2.5-flash'];
  }

  return TOKEN_PRICING_USD_PER_MILLION['googleai/gemini-2.5-pro'];
}

export function estimateTokenCostUsd(
  modelName: string,
  usage?: Partial<UsageSnapshot> | null,
): number {
  const normalizedUsage = normalizeUsage(usage);
  const pricing = getPricing(modelName);

  return (
    (normalizedUsage.inputTokens / 1_000_000) * pricing.input
    + (normalizedUsage.outputTokens / 1_000_000) * pricing.output
  );
}

export function estimateCost(modelName: string, usage?: Partial<UsageSnapshot> | null): number {
  return estimateTokenCostUsd(modelName, usage);
}

export function logGenerationMetrics(metrics: UsageMetrics): void {
  const {
    modelName,
    chunkCount,
    durationMs,
    cacheHits,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
  } = metrics;

  const costPart = typeof estimatedCostUsd === 'number'
    ? ` estimatedCostUsd=${estimatedCostUsd.toFixed(6)}`
    : '';

  console.log(
    `[Metrics] model=${modelName} chunks=${chunkCount} duration=${durationMs}ms cacheHits=${cacheHits} inputTokens=${inputTokens} outputTokens=${outputTokens} totalTokens=${totalTokens}${costPart}`,
  );
}
