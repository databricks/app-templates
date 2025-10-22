import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';

export type DatabricksStreamPartTransformer<
  Out extends LanguageModelV2StreamPart,
> = (
  parts: LanguageModelV2StreamPart[],
  last: LanguageModelV2StreamPart | null,
) => {
  out: Out[];
};

/* -----------------------------------------------------------------
   Tiny helpers for the type‑level plumbing
   ----------------------------------------------------------------- */

/** Extract the element type (`Out`) from a concrete transformer. */
type OutElement<TFn> = TFn extends (
  parts: any,
  last: any,
) => { out: (infer O)[] }
  ? O
  : never;

/** Return the last element of a tuple type. */
type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;

/**
 * Compose an arbitrary number of `DatabricksStreamPartTransformer`s.
 *
 * The returned function has the exact same signature as a normal transformer,
 * but its `out`‑element type is inferred from the **last** transformer you pass
 * in.
 *
 * Runtime behaviour:
 *   1️⃣ Call the first transformer with the supplied `parts` and the
 *      caller‑provided `last` (usually `null`).
 *   2️⃣ Take its `out` and `last` and feed them to the next transformer.
 *   3️⃣ …repeat until the last transformer runs.
 *   4️⃣ Return the `out`/`last` of that final transformer.
 */
export function composeDatabricksStreamPartTransformers<
  T extends DatabricksStreamPartTransformer<any>[],
>(...transformers: T): DatabricksStreamPartTransformer<OutElement<Last<T>>> {
  // The generic `OutElement<Last<T>>` is the element type of the **last**
  // transformer, so the returned function has the correct inferred type.
  return (
    initialParts: LanguageModelV2StreamPart[],
    last: LanguageModelV2StreamPart | null = null,
  ) => {
    // ‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑-
    // Runtime state that moves through the pipeline
    // ‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑‑-
    let currentParts = initialParts;

    // Execute each transformer in order, threading the two values.
    for (const fn of transformers) {
      const result = fn(currentParts as LanguageModelV2StreamPart[], last);
      currentParts = result.out;
    }

    // `OutElement<Last<T>>` is exactly the element type that the *last*
    // transformer emitted, so the cast is safe.
    return {
      out: currentParts as OutElement<Last<T>>[],
    };
  };
}
