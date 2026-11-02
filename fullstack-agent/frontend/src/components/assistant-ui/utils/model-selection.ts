"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ModelSelectorEffortOption = {
  id: string;
  name: string;
};

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  // Omit for models without configurable reasoning.
  efforts?: readonly ModelSelectorEffortOption[];
};

export function getModelEfforts(
  model: ModelOption | undefined,
): readonly ModelSelectorEffortOption[] | undefined {
  return model?.efforts;
}

export function resolveEffort(
  efforts: readonly ModelSelectorEffortOption[] | undefined,
  effort: string | undefined,
): string | undefined {
  if (effort === undefined) return undefined;
  return efforts?.some((e) => e.id === effort) ? effort : undefined;
}

export function useControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop: T | undefined;
  defaultProp: T | undefined;
  onChange: ((next: T) => void) | undefined;
}) {
  const [internal, setInternal] = useState(defaultProp);
  const isControlled = prop !== undefined;
  const value = isControlled ? prop : internal;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      onChangeRef.current?.(next);
    },
    [isControlled],
  );
  return [value, setValue] as const;
}

type ModelSelectorContextValue = {
  models: readonly ModelOption[];
  value: string | undefined;
  setValue: (value: string) => void;
  selectedModel: ModelOption | undefined;
  efforts: readonly ModelSelectorEffortOption[] | undefined;
  effort: string | undefined;
  setEffort: (effort: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
};

export const ModelSelectorContext =
  createContext<ModelSelectorContextValue | null>(null);

export function useModelSelectorContext() {
  const ctx = useContext(ModelSelectorContext);
  if (!ctx) {
    throw new Error(
      "ModelSelector sub-components must be used within ModelSelector.Root",
    );
  }
  return ctx;
}

// Access effort levels for custom UI inside ModelSelector.Content.
export function useModelSelectorEfforts(): {
  efforts: readonly ModelSelectorEffortOption[] | undefined;
  effort: string | undefined;
  setEffort: (effort: string) => void;
} {
  const { efforts, effort, setEffort } = useModelSelectorContext();
  return { efforts, effort, setEffort };
}

// Track popover flip side once to avoid flipping mid-interaction. Pass open and preferred for force-mounted popups.
export function useLazyFlipSide<TSide extends string>(
  open = true,
  preferred?: TSide,
): {
  side: TSide | undefined;
  popupRef: (node: HTMLDivElement | null) => void;
} {
  const [side, setSide] = useState<TSide | undefined>();
  const observerRef = useRef<MutationObserver | null>(null);
  const preferredRef = useRef(preferred);
  preferredRef.current = preferred;
  const popupRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || !open) {
        setSide(undefined);
        return;
      }
      const current = node.getAttribute("data-side");
      const hasFlipped =
        preferredRef.current !== undefined &&
        current !== null &&
        current !== preferredRef.current;
      if (hasFlipped) {
        setSide(current as TSide);
        return;
      }
      const observer = new MutationObserver(() => {
        const rendered = node.getAttribute("data-side");
        if (!rendered) return;
        observer.disconnect();
        setSide(rendered as TSide);
      });
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["data-side"],
      });
      observerRef.current = observer;
    },
    [open],
  );
  return { side, popupRef };
}
