import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ApiError, isApiError } from './http';

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** Re-run the loader. `silent` keeps current data on screen (used for polling). */
  reload: (options?: { silent?: boolean }) => Promise<void>;
  setData: (updater: T | ((current: T | undefined) => T)) => void;
}

export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return new ApiError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Something went wrong.', 0);
}

/** Runs an API loader, cancelling the in-flight request when deps change or the component unmounts. */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController>();
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async (silent = false) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (!silent) setLoading(true);
    try {
      const result = await loaderRef.current(controller.signal);
      if (controller.signal.aborted) return;
      setDataState(result);
      setError(undefined);
    } catch (err) {
      if (controller.signal.aborted) return;
      const apiError = toApiError(err);
      if (apiError.code === 'ABORTED') return;
      setError(apiError);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    return () => controllerRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback((options?: { silent?: boolean }) => run(options?.silent), [run]);

  const setData = useCallback((updater: T | ((current: T | undefined) => T)) => {
    setDataState((current) =>
      typeof updater === 'function' ? (updater as (c: T | undefined) => T)(current) : updater,
    );
  }, []);

  return { data, error, loading, reload, setData };
}

/** Calls `callback` every `intervalMs` while `active` is true and the tab is visible. */
export function usePolling(callback: () => void, intervalMs: number, active: boolean) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') callbackRef.current();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
}
