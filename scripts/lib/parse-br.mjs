/**
 * Parsers de número em formato brasileiro. Módulo puro, sem dependência de
 * driver de banco — `carteira-snapshot.mjs` importava isto de `abeweb.mjs`, que
 * carrega o `mssql` inteiro só para normalizar uma linha.
 */

/** "1.234,56" → 1234.56. Valor ausente ou ilegível vira 0. */
export function parseBrDecimal(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const s = String(value).trim();
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  let normalized;
  if (hasComma) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    const last = parts[parts.length - 1] ?? '';
    // "1234.56" é decimal; "1.234.567" é separador de milhar.
    if (parts.length === 2 && last.length <= 2) {
      normalized = s;
    } else {
      normalized = s.replace(/\./g, '');
    }
  } else {
    normalized = s;
  }

  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}
