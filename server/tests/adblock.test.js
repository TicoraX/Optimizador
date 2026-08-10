// El parser de listas y el lector del bloque del hosts son las dos piezas que
// deciden que se escribe en un archivo del sistema. Se prueban sin tocar nada:
// ambas son funciones puras sobre texto.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHostsList, estadoHosts } from '../lib/adblock.js';

describe('parseHostsList', () => {
  it('acepta las dos formas en que vienen las fuentes', () => {
    const d = parseHostsList('0.0.0.0 ads.example.com\ntracker.example.org\n127.0.0.1 otro.example.net');
    assert.deepEqual([...d].sort(), ['ads.example.com', 'otro.example.net', 'tracker.example.org']);
  });

  it('ignora comentarios y lineas vacias', () => {
    const d = parseHostsList('# comentario\n\n0.0.0.0 uno.com # al final\n   \n');
    assert.deepEqual([...d], ['uno.com']);
  });

  it('descarta lo que no es un dominio', () => {
    // La lista se baja de internet: todo lo que no sea claramente un dominio
    // se tira, porque termina escrito en un archivo del sistema.
    const basura = [
      '0.0.0.0 con espacio.com',
      '0.0.0.0 ../../etc/passwd',
      '0.0.0.0 http://con-esquema.com',
      '0.0.0.0 -empieza-con-guion.com',
      '0.0.0.0 sinpunto',
      '0.0.0.0 dos..puntos.com',
      '0.0.0.0 ' + 'a'.repeat(300) + '.com',
    ].join('\n');
    assert.equal(parseHostsList(basura).size, 0);
  });

  it('descarta direcciones IP sueltas', () => {
    // Encontrado con datos reales: las fuentes traen lineas con solo `0.0.0.0`,
    // que pasaban el regex y quedaban escritas en el hosts como si fueran un
    // dominio. Ningun TLD real es numerico.
    const d = parseHostsList('0.0.0.0\n1.2.3.4\n0.0.0.0 8.8.8.8\n0.0.0.0 real.com');
    assert.deepEqual([...d], ['real.com']);
  });

  it('no bloquea localhost', () => {
    assert.equal(parseHostsList('127.0.0.1 localhost\n::1 localhost').size, 0);
  });

  it('deduplica', () => {
    assert.equal(parseHostsList('0.0.0.0 a.com\n0.0.0.0 a.com\na.com').size, 1);
  });
});

describe('estadoHosts', () => {
  const INICIO = '# === OPTIMIZADOR ADBLOCK INICIO (no editar a mano) ===';
  const FIN = '# === OPTIMIZADOR ADBLOCK FIN ===';

  it('detecta que no hay bloqueo', () => {
    assert.deepEqual(estadoHosts('127.0.0.1 localhost\n'), { activo: false, dominios: 0 });
  });

  it('cuenta solo lo que esta dentro del bloque propio', () => {
    const hosts = [
      '127.0.0.1 miapp.local',   // entrada del usuario, fuera del bloque
      INICIO,
      '# generado el 2026-08-10',
      '0.0.0.0 ads.example.com',
      '0.0.0.0 tracker.example.org',
      FIN,
    ].join('\n');
    assert.deepEqual(estadoHosts(hosts), { activo: true, dominios: 2 });
  });

  it('no se cuelga si falta el marcador de cierre', () => {
    const hosts = [INICIO, '0.0.0.0 ads.example.com'].join('\n');
    assert.deepEqual(estadoHosts(hosts), { activo: true, dominios: 1 });
  });
});
