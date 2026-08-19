import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DNS_ACTIONS,
  parseDisplayDns,
  runDnsFlushActionNative,
} from '../lib/dnsflush.js';

describe('Monitor y Limpiador de Caché DNS (dnsflush.js)', () => {
  it('expone las acciones clave de refresco de red', () => {
    assert.ok(DNS_ACTIONS.length >= 3);
    assert.ok(DNS_ACTIONS.some((a) => a.id === 'flushdns'));
    assert.ok(DNS_ACTIONS.some((a) => a.id === 'registerdns'));
    assert.ok(DNS_ACTIONS.some((a) => a.id === 'purgenbtstat'));
  });

  it('parseDisplayDns extrae registros en español e inglés', () => {
    const raw = `
Nombre de registro . : google.com
Tipo de registro . . : 1
Tiempo de vida . . . : 299
Longitud de datos. . : 4
Sección. . . . . . . : Respuesta
Registro A (host). . : 142.250.190.46

Record Name . . . . . : github.com
Record Type . . . . . : 1
Time To Live. . . . . : 60
Data Length . . . . . : 4
Section . . . . . . . : Answer
A (Host) Record . . . : 140.82.121.4
`;
    const records = parseDisplayDns(raw);
    assert.equal(records.length, 2);
    assert.equal(records[0].name, 'google.com');
    assert.equal(records[0].ttl, '299');
    assert.equal(records[1].name, 'github.com');
    assert.equal(records[1].ttl, '60');
  });

  it('runDnsFlushActionNative en dryRun no ejecuta comandos reales', async () => {
    const logs = [];
    await runDnsFlushActionNative({
      DRY_RUN: 'true',
      ACTIONS: 'flushdns,registerdns',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando refresco y purga de caché DNS')));
    assert.ok(logs.some((l) => l.includes('finalizado')));
  });
});
