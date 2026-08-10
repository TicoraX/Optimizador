// Los dos parsers del diagnostico de red. Se prueban con salida real de
// `ping` y `tracert`, en espaniol e ingles: el modulo de energia ya se habia
// roto por depender de un literal en ingles.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analizarPings, parseTracert } from '../lib/network.js';

const PING_ES = `
Haciendo ping a 8.8.8.8 con 32 bytes de datos:
Respuesta desde 8.8.8.8: bytes=32 tiempo=20ms TTL=118
Respuesta desde 8.8.8.8: bytes=32 tiempo=24ms TTL=118
Respuesta desde 8.8.8.8: bytes=32 tiempo=22ms TTL=118
Respuesta desde 8.8.8.8: bytes=32 tiempo=30ms TTL=118

Estadisticas de ping para 8.8.8.8:
    Paquetes: enviados = 4, recibidos = 4, perdidos = 0 (0% perdidos),
Tiempos aproximados de ida y vuelta en milisegundos:
    Minimo = 20ms, Maximo = 30ms, Media = 24ms
`;

const PING_EN = `
Reply from 8.8.8.8: bytes=32 time=20ms TTL=118
Reply from 8.8.8.8: bytes=32 time<1ms TTL=118
Request timed out.
Reply from 8.8.8.8: bytes=32 time=22ms TTL=118
`;

describe('analizarPings', () => {
  it('lee las respuestas en espaniol', () => {
    const r = analizarPings(PING_ES, 4);
    assert.equal(r.recibidos, 4);
    assert.equal(r.perdidaPct, 0);
    assert.equal(r.min, 20);
    assert.equal(r.max, 30);
  });

  it('ignora la linea de resumen', () => {
    // Encontrado corriendo el diagnostico real: "Minimo = 20ms, Maximo = 30ms,
    // Media = 24ms" tambien tiene `= NNms` y se contaba como tres respuestas
    // mas, dando 23 muestras sobre 20 enviadas y perdida negativa.
    const r = analizarPings(PING_ES, 4);
    assert.equal(r.recibidos, 4, 'el resumen no debe contarse como respuestas');
    assert.ok(r.perdidaPct >= 0, 'la perdida nunca puede ser negativa');
  });

  it('lee las respuestas en ingles, incluido time<1ms', () => {
    const r = analizarPings(PING_EN, 4);
    assert.equal(r.recibidos, 3);
    assert.equal(r.min, 1, 'time<1ms cuenta como 1');
  });

  it('calcula la perdida contando respuestas, no parseando el resumen', () => {
    // El resumen de ping esta traducido; contar respuestas no depende del idioma.
    assert.equal(analizarPings(PING_EN, 4).perdidaPct, 25);
  });

  it('no divide por cero cuando no responde nada', () => {
    const r = analizarPings('Tiempo de espera agotado.', 4);
    assert.deepEqual(r, {
      recibidos: 0, perdidaPct: 100, min: null, mediana: null, p95: null, max: null, jitter: null,
    });
  });

  it('el jitter es cero si todas las muestras son iguales', () => {
    const igual = Array(5).fill('Respuesta desde 8.8.8.8: bytes=32 tiempo=20ms TTL=118').join('\n');
    assert.equal(analizarPings(igual, 5).jitter, 0);
  });
});

describe('parseTracert', () => {
  const SALIDA = `
Traza a 8.8.8.8 sobre un maximo de 10 saltos:

  1     1 ms     1 ms     1 ms  192.168.1.1
  2    11 ms    10 ms    12 ms  10.20.30.1
  3     *        *        *     Tiempo de espera agotado para esta solicitud.
  4    21 ms    20 ms    20 ms  8.8.8.8

Traza completa.
`;

  it('extrae los saltos con su latencia', () => {
    const s = parseTracert(SALIDA);
    assert.equal(s.length, 4);
    assert.deepEqual(s[0], { salto: 1, ip: '192.168.1.1', ms: 1, responde: true });
    assert.equal(s[3].ip, '8.8.8.8');
  });

  it('marca los saltos que no responden sin perder su posicion', () => {
    const s = parseTracert(SALIDA);
    assert.equal(s[2].responde, false);
    assert.equal(s[2].ms, null);
    assert.equal(s[2].salto, 3, 'el numero de salto se conserva aunque no responda');
  });

  it('se queda con el minimo de las tres sondas', () => {
    assert.equal(parseTracert('  2    11 ms    10 ms    12 ms  10.20.30.1')[0].ms, 10);
  });
});
