import http from 'node:http';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const PORT = 3200 + Math.floor(Math.random() * 500);
process.env.PORT = String(PORT);
process.env.NODE_ENV = 'test';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${PORT}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Origin': `http://127.0.0.1:${PORT}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

function requestSSE(path, body = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: {
        'Origin': `http://127.0.0.1:${PORT}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let output = '';
      const events = [];
      res.on('data', (chunk) => {
        const text = chunk.toString('utf-8');
        output += text;
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            events.push(line.slice(6));
          }
        }
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, output, events });
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

describe('E2E QA Suite — Verificación Segura (Zero Destructive Changes / dryRun)', () => {
  before(async () => {
    await import('../server.js');
    await new Promise((r) => setTimeout(r, 1000));
  });

  it('GET /api/health responde status ok', async () => {
    const res = await request('/api/health');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.status, 'ok');
  });

  it('GET /api/system/metrics retorna telemetría completa', async () => {
    const res = await request('/api/system/metrics');
    assert.equal(res.statusCode, 200);
    assert.ok(res.json?.cpu);
    assert.ok(res.json?.ram);
  });

  it('GET /api/status retorna estado consolidado de módulos', async () => {
    const res = await request('/api/status');
    assert.equal(res.statusCode, 200);
  });

  it('GET /api/timeline responde con array', async () => {
    const res = await request('/api/timeline');
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json));
  });

  it('GET / sirve el frontend estático de producción', async () => {
    const res = await request('/');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('<html') || res.body.includes('<!DOCTYPE html') || res.body.includes('Optimizador'));
  });

  it('POST /api/action/:module sin selección rechaza limpiamente con HTTP 400', async () => {
    const res = await request('/api/action/gaming', { method: 'POST', body: {} });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json?.error.includes('seleccionado'));
  });

  const testModules = [
    { mod: 'gaming', body: { dryRun: true, settings: 'gamemode' } },
    { mod: 'timers', body: { dryRun: true, settings: 'disabledynamictick' } },
    { mod: 'searchindex', body: { dryRun: true, settings: 'disablewebsearch' } },
    { mod: 'networkprivacy', body: { dryRun: true, settings: 'wifisense' } },
    { mod: 'pagefile', body: { dryRun: true, settings: 'disablepagingexecutive' } },
    { mod: 'werfault', body: { dryRun: true, settings: 'disablewer' } },
    { mod: 'integrity', body: { dryRun: true, actions: 'winsxs_cleanup' } },
    { mod: 'dnsflush', body: { dryRun: true, actions: 'flushdns' } },
    { mod: 'ghostdevices', body: { dryRun: true, devices: 'USB\\FAKE_DEVICE' } },
    { mod: 'oemdebloat', body: { dryRun: true, services: 'TestService', mode: 'demand' } },
    { mod: 'contextmenu', body: { dryRun: true, handlers: 'HKCR\\*\\shellex\\ContextMenuHandlers\\Test' } },
    { mod: 'services', body: { dryRun: true, services: 'Spooler' } },
    { mod: 'apps', body: { dryRun: true, apps: 'FakeApp.FakeApp' } },
    { mod: 'privacy', body: { dryRun: true, privacy: '1' } },
    { mod: 'network', body: { dryRun: true } },
    { mod: 'adblock', body: { dryRun: true, adblockAction: 'remove' } },
    { mod: 'cleanup', body: { dryRun: true, cleanCategories: ['temp'] } },
    { mod: 'startup', body: { dryRun: true, programs: ['TestProg'] } },
    { mod: 'ram', body: { dryRun: true, processes: '1234', cleanMode: 'soft', minRamMB: 50 } },
  ];

  for (const { mod, body } of testModules) {
    it(`SSE POST /api/action/${mod} en dryRun ejecuta y finaliza exitosamente con done`, async () => {
      const res = await requestSSE(`/api/action/${mod}`, body);
      assert.equal(res.statusCode, 200);
      assert.ok(res.output.includes('event: done'));
    });
  }
});
