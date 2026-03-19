import { genkit, type GenerationUsage } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI()],
  model: process.env.GEMINI_MODEL_PRIMARY || 'googleai/gemini-2.5-pro',
});

export type ModelConfig = {
  primary: string;
  cost: string;
  fallback: string;
  useBatch: boolean;
  batchThreshold: number;
};

export function getModelConfig() {
  return {
    primary: process.env.GEMINI_MODEL_PRIMARY || 'googleai/gemini-2.5-pro',
    cost: process.env.GEMINI_MODEL_COST || 'googleai/gemini-2.5-flash',
    fallback: process.env.GEMINI_MODEL_FALLBACK || 'googleai/gemini-2.5-flash-lite',
    useBatch: process.env.GEMINI_USE_BATCH === 'true',
    batchThreshold: Number(process.env.GEMINI_BATCH_THRESHOLD || '5'),
  };
}

export function getModelCandidates(preferredModel?: string): string[] {
  const config = getModelConfig();
  const preferred = preferredModel || config.primary;
  // Order: preferred → cost (gemini-2.5-flash) → fallback (gemini-2.5-flash-lite)
  const candidates = [preferred, config.cost, config.fallback].filter(Boolean);
  return Array.from(new Set(candidates));
}

export function getEffectiveModel(chunkCount: number = 0): string {
  const config = getModelConfig();

  if (config.useBatch && chunkCount > config.batchThreshold) {
    console.info(
      `[ModelSelector] Using cost model "${config.cost}" for ${chunkCount} chunks (threshold: ${config.batchThreshold}).`
    );
    return config.cost;
  }

  return config.primary;
}

type GenerateTextOptions = {
  prompt: string;
  preferredModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type GenerateTextResult = {
  text: string;
  modelUsed: string;
  usedFallback: boolean;
  usage: LlmUsage;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isModelUnavailableError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes('model') &&
    (message.includes('not found') ||
      message.includes('not supported') ||
      message.includes('404'))
  );
}

function isTransientError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes('503') ||
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('rate limit')
  );
}

function isQuotaExhaustedError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes('429') ||
    message.includes('quota') ||
    message.includes('resource_exhausted') ||
    message.includes('resource exhausted')
  );
}

function normalizeUsage(usage?: GenerationUsage): LlmUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? (inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

async function generateWithTimeout(
  prompt: string,
  model: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<{ text: string; usage: LlmUsage }> {
  const controller = new AbortController();
  let timedOut = false;
  let abortedByCaller = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const handleExternalAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      handleExternalAbort();
    } else {
      abortSignal.addEventListener('abort', handleExternalAbort, { once: true });
    }
  }

  try {
    const response = await ai.generate({
      model: googleAI.model(model),
      prompt,
      abortSignal: controller.signal,
    });

    return {
      text: (response.text ?? '').trim(),
      usage: normalizeUsage(response.usage),
    };
  } catch (error) {
    if (timedOut) {
      throw new Error(`LLM timeout after ${timeoutMs}ms (${model})`);
    }

    if (abortedByCaller) {
      throw new Error(`LLM request aborted (${model})`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    if (abortSignal) {
      abortSignal.removeEventListener('abort', handleExternalAbort);
    }
  }
}

export async function generateTextWithFallback(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxRetries = options.maxRetries ?? 3;
  const candidates = getModelCandidates(options.preferredModel);
  const primary = candidates[0];
  let lastError: unknown;

  for (const model of candidates) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { text, usage } = await generateWithTimeout(
          options.prompt,
          model,
          timeoutMs,
          options.abortSignal,
        );
        return {
          text,
          modelUsed: model,
          usedFallback: model !== primary,
          usage,
        };
      } catch (error) {
        lastError = error;
        const modelUnavailable = isModelUnavailableError(error);
        const quotaExhausted = isQuotaExhaustedError(error);
        const transient = isTransientError(error);

        if (modelUnavailable || quotaExhausted) {
          console.warn(`[ModelFallback] Model "${model}" ${quotaExhausted ? 'quota exhausted' : 'unavailable'}, trying next model...`);
          break; // skip to next model in candidates
        }

        if (!transient || attempt === maxRetries) {
          break;
        }

        const backoffMs = 400 * 2 ** (attempt - 1);
        console.warn(`[LLM-Retry] model=${model}, attempt=${attempt}, backoffMs=${backoffMs}`);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('LLM generation failed');
}
