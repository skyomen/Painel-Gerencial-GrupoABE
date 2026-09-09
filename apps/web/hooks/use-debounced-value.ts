'use client';

import { useEffect, useState } from 'react';

/**
 * Espaça mudanças rápidas de um valor. Nos filtros isso importa porque
 * `<input type="date">` dispara `change` ao preencher dia, mês e ano —
 * três buscas para escolher uma data.
 *
 * O valor exibido continua mudando na hora; só a busca espera.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
