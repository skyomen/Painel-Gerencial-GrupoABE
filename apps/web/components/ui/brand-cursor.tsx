'use client';

import { useEffect, useRef, useState } from 'react';
import { BrandLogoStack } from '@/components/ui/brand-logo-stack';
import { BRAND_LOGO_CYCLE_MS, BRAND_MOUSE_LOGOS } from '@/lib/brand-logos';
import { useIsLoading } from '@/lib/loading-tracker';

/** Área de posicionamento do ponteiro (centro do mouse) */
const CURSOR_SIZE = 30;

function setNativeCursorHidden(hidden: boolean) {
  document.documentElement.classList.toggle('brand-custom-cursor', hidden);
}

/**
 * Logos no ponteiro — ativo somente enquanto há carregamento real em curso
 * (uma requisição `fetch` em voo, via `useIsLoading`). Ao terminar, o cursor
 * nativo volta na hora.
 */
export function BrandCursor() {
  const carregando = useIsLoading();
  const [ativo, setAtivo] = useState(false);
  const [logoIndex, setLogoIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: -100, y: -100 });
  const lastCycleRef = useRef(0);
  const ativoRef = useRef(false);
  const rafRef = useRef<number>(0);
  const enabledRef = useRef(true);

  // Posiciona o overlay junto do cursor — necessário mesmo fora do
  // carregamento, pra já saber onde desenhar assim que `ativo` vira true.
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    enabledRef.current = !reducedMotion && !coarsePointer;
    if (!enabledRef.current) return;

    const onMove = (event: MouseEvent) => {
      posRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('mousemove', onMove, { passive: true });

    const tick = (now: number) => {
      if (ativoRef.current && now - lastCycleRef.current >= BRAND_LOGO_CYCLE_MS) {
        lastCycleRef.current = now;
        setLogoIndex((i) => (i + 1) % BRAND_MOUSE_LOGOS.length);
      }

      const el = rootRef.current;
      if (el && ativoRef.current) {
        const x = posRef.current.x - CURSOR_SIZE / 2;
        const y = posRef.current.y - CURSOR_SIZE / 2;
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      setNativeCursorHidden(false);
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Único gatilho de ativação/desativação: carregamento real em voo.
  useEffect(() => {
    if (!enabledRef.current) return;
    ativoRef.current = carregando;
    setAtivo(carregando);
    setNativeCursorHidden(carregando);
    if (carregando) lastCycleRef.current = performance.now();
  }, [carregando]);

  if (!ativo) return null;

  return (
    <div
      ref={rootRef}
      className="brand-cursor pointer-events-none fixed left-0 top-0 z-[9999] will-change-transform"
      style={{ width: CURSOR_SIZE, height: CURSOR_SIZE }}
      aria-hidden
    >
      <BrandLogoStack size={CURSOR_SIZE} activeIndex={logoIndex} />
    </div>
  );
}
