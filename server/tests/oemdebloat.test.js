import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchOemService,
  parseServicesCsv,
  runOemDebloatActionNative,
} from '../lib/oemdebloat.js';

describe('Auditor y Debloater OEM (oemdebloat.js)', () => {
  it('matchOemService detecta firmas de fabricantes correctamente', () => {
    const dell = matchOemService('DellSupportAssist', 'Dell SupportAssist Agent');
    assert.ok(dell);
    assert.equal(dell.oem, 'Dell');

    const hp = matchOemService('HpTouchpointAnalytics', 'HP Touchpoint Analytics Service');
    assert.ok(hp);
    assert.equal(hp.oem, 'HP');

    const asus = matchOemService('ArmouryCrateControlInterface', 'ASUS Armoury Crate Control');
    assert.ok(asus);
    assert.equal(asus.oem, 'ASUS');

    const generic = matchOemService('Spooler', 'Cola de impresión');
    assert.equal(generic, null);
  });

  it('parseServicesCsv parsea CSV de wmic correctamente', () => {
    const raw = `
Node,DisplayName,Name,StartMode,State
DESKTOP,Dell SupportAssist,DellSupportAssist,Auto,Running
DESKTOP,Audio de Windows,AudioSrv,Auto,Running
`;
    const services = parseServicesCsv(raw);
    assert.equal(services.length, 2);
    assert.equal(services[0].name, 'DellSupportAssist');
    assert.equal(services[0].startMode, 'Auto');
  });

  it('runOemDebloatActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runOemDebloatActionNative({
      DRY_RUN: 'true',
      SERVICES: 'DellSupportAssist',
      MODE: 'demand',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando optimización de servicios OEM')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
