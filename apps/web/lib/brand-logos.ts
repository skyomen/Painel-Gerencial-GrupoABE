/** Logos do Grupo ABE — carregamento e ponteiro do mouse. */
export const BRAND_MOUSE_LOGOS = [
  { src: '/sources/ponteiro-mouse/ABE.svg', alt: 'ABE', scale: 1.35 },
  { src: '/sources/ponteiro-mouse/Avantpay.svg', alt: 'Avantpay', scale: 0.92 },
  { src: '/sources/ponteiro-mouse/Acordoseguro.svg', alt: 'Acordo Seguro', scale: 0.92 },
  { src: '/sources/ponteiro-mouse/Grejoadv.svg', alt: 'Grejo Adv', scale: 0.92 },
] as const;

/** Fração da área usada como base do desenho (ajustada por `scale` de cada logo). */
export const BRAND_LOGO_DRAW_RATIO = 0.82;

export const BRAND_LOGO_CYCLE_MS = 1100;
export const BRAND_LOGO_FADE_MS = 420;
