import { describe, expect, it } from 'vitest';
import {
  CICLOS,
  CICLO_FACTURA,
  CICLO_PAGO,
  CICLO_PEDIDO,
  TransicionInvalidaError,
  esEstadoFinal,
  eventoDeCreacion,
  eventoDeTransicion,
  puedeTransicionar,
} from './ciclos.js';

describe('ciclos de vida', () => {
  it.each(Object.values(CICLOS))('$entidad: todo destino es un estado declarado', (ciclo) => {
    const estados = Object.keys(ciclo.transiciones);
    for (const destinos of Object.values(ciclo.transiciones)) {
      for (const destino of Object.keys(destinos as object)) expect(estados).toContain(destino);
    }
    for (const inicial of Object.keys(ciclo.iniciales)) expect(estados).toContain(inicial);
  });

  it.each(Object.values(CICLOS))('$entidad: todo estado es alcanzable desde un estado inicial', (ciclo) => {
    const alcanzados = new Set(Object.keys(ciclo.iniciales));
    const pendientes = [...alcanzados];
    while (pendientes.length > 0) {
      const actual = pendientes.pop()!;
      for (const destino of Object.keys(ciclo.transiciones[actual as never] as object)) {
        if (!alcanzados.has(destino)) {
          alcanzados.add(destino);
          pendientes.push(destino);
        }
      }
    }
    expect([...alcanzados].sort()).toEqual(Object.keys(ciclo.transiciones).sort());
  });

  it('un pedido cancelado no puede facturarse', () => {
    expect(puedeTransicionar(CICLO_PEDIDO, 'CANCELADO', 'FACTURADO')).toBe(false);
    expect(() => eventoDeTransicion(CICLO_PEDIDO, 'CANCELADO', 'FACTURADO')).toThrow(TransicionInvalidaError);
  });

  it('un pedido emitido no puede facturarse sin aprobación', () => {
    expect(puedeTransicionar(CICLO_PEDIDO, 'EMITIDO', 'FACTURADO')).toBe(false);
  });

  it('una factura entregada no se anula; solo revierte a despachada si se anula la entrega', () => {
    expect(puedeTransicionar(CICLO_FACTURA, 'ENTREGADA', 'ANULADA')).toBe(false);
    expect(puedeTransicionar(CICLO_FACTURA, 'ENTREGADA', 'EMITIDA')).toBe(false);
    expect(eventoDeTransicion(CICLO_FACTURA, 'ENTREGADA', 'DESPACHADA')).toBe('FACTURA_ENTREGA_REVERTIDA');
    expect(esEstadoFinal(CICLO_FACTURA, 'ANULADA')).toBe(true);
  });

  it('una factura despachada vuelve a pendiente si el cliente rechaza todo', () => {
    expect(eventoDeTransicion(CICLO_FACTURA, 'DESPACHADA', 'EMITIDA')).toBe('FACTURA_RETORNADA');
  });

  it('un pago rechazado no puede validarse después', () => {
    expect(puedeTransicionar(CICLO_PAGO, 'RECHAZADO', 'VALIDADO')).toBe(false);
  });

  it('un pago solo nace registrado', () => {
    expect(eventoDeCreacion(CICLO_PAGO, 'REGISTRADO')).toBe('PAGO_REGISTRADO');
    expect(() => eventoDeCreacion(CICLO_PAGO, 'VALIDADO')).toThrow(TransicionInvalidaError);
  });
});
