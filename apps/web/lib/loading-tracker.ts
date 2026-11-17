/**
 * Rastreador simples de requisições `fetch` em voo, exposto via
 * `useSyncExternalStore` como `useIsLoading()`. Único sinal global de
 * "carregando" do app — usado pelo `BrandCursor` para saber quando mostrar
 * o efeito de logos no lugar do cursor nativo.
 */
import { useEffect, useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeLoading(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLoadingSnapshot() {
  return count > 0;
}

export function getLoadingServerSnapshot() {
  return false;
}

let patched = false;

/** Intercepta o fetch global uma única vez para contar requisições em voo. */
export function ensureFetchTracked() {
  if (patched || typeof window === 'undefined') return;
  patched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    count += 1;
    notify();
    try {
      return await originalFetch(...args);
    } finally {
      count -= 1;
      notify();
    }
  }) as typeof fetch;
}

export function useIsLoading(): boolean {
  useEffect(() => {
    ensureFetchTracked();
  }, []);
  return useSyncExternalStore(subscribeLoading, getLoadingSnapshot, getLoadingServerSnapshot);
}
