/** Account UI observation on 2026-11-06. Any future generation requires a fresh platform quote. */
export const H3_POLICY = Object.freeze({
  model: 'MiniMax H3',
  spendNow: 0,
  totalLimit: 100,
  minSeconds: 5,
  maxSeconds: 15,
  rates: Object.freeze({'768P': 50, '2K': 85}),
});

/** Estimate a single clip without submitting a job. Reference-video input has a separate per-second charge. */
export function h3Estimate({model, resolution, seconds, referenceSeconds = 0}) {
  if (model !== H3_POLICY.model) throw new Error('H3_MODEL_REQUIRED');
  if (!Object.hasOwn(H3_POLICY.rates, resolution)) throw new Error('UNVERIFIED_H3_RESOLUTION');
  if (!Number.isInteger(seconds) || seconds < H3_POLICY.minSeconds || seconds > H3_POLICY.maxSeconds) {
    throw new Error('H3_DURATION_OUT_OF_RANGE');
  }
  // Fractional reference lengths need a provider quote: its rounding rule was not published in the table.
  if (!Number.isSafeInteger(referenceSeconds) || referenceSeconds < 0) throw new Error('REFERENCE_QUOTE_REQUIRED');
  const credits = H3_POLICY.rates[resolution] * (seconds + referenceSeconds);
  if (!Number.isSafeInteger(credits)) throw new Error('REFERENCE_QUOTE_REQUIRED');
  return {credits, withinOverallLimit: credits <= H3_POLICY.totalLimit, submitAllowed: false};
}
