import { describe, expect, it } from 'vitest';
import { normalizarReferencia, validarReferencia } from './pagos.js';

describe('referencias de pago', () => {
  it('quita separadores y pasa a mayúsculas', () => {
    expect(normalizarReferencia(' 0102-3456 789 ')).toBe('01023456789');
    expect(normalizarReferencia('ab-12.cd')).toBe('AB12CD');
  });

  it('dos escrituras de la misma referencia normalizan igual', () => {
    expect(normalizarReferencia('1234 5678')).toBe(normalizarReferencia('1234-5678'));
  });

  it('efectivo no lleva referencia', () => {
    expect(validarReferencia('EFECTIVO', null)).toEqual({ ok: true, referencia: null });
    expect(validarReferencia('EFECTIVO', '123').ok).toBe(false);
  });

  it('transferencia exige referencia numérica', () => {
    expect(validarReferencia('TRANSFERENCIA', '')).toMatchObject({ ok: false });
    expect(validarReferencia('TRANSFERENCIA', 'ABC123')).toMatchObject({ ok: false });
    expect(validarReferencia('TRANSFERENCIA', '0001-2345')).toEqual({ ok: true, referencia: '00012345' });
  });
});
