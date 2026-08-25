import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GENERIC_PANEL_CONFIG } from '../components/panelConfig.js';
import { GENERIC_MODULES } from '../hooks/useModuleItems.js';

describe('Validación de panelConfig y módulos genéricos (Frontend)', () => {
  const expectedModules = [
    'services', 'apps', 'privacy', 'gaming', 'integrity',
    'contextmenu', 'oemdebloat', 'timers', 'ghostdevices',
    'searchindex', 'dnsflush', 'networkprivacy', 'pagefile', 'werfault'
  ];

  it('todos los módulos esperados existen en GENERIC_MODULES y GENERIC_PANEL_CONFIG', () => {
    for (const mod of expectedModules) {
      assert.ok(GENERIC_MODULES.has(mod), `Falta ${mod} en GENERIC_MODULES`);
      assert.ok(GENERIC_PANEL_CONFIG[mod], `Falta ${mod} en GENERIC_PANEL_CONFIG`);
      assert.ok(GENERIC_PANEL_CONFIG[mod].label, `${mod} debe tener label`);
      assert.ok(GENERIC_PANEL_CONFIG[mod].bodyKey, `${mod} debe tener bodyKey`);
    }
  });

  it('los bodyKeys coinciden con lo esperado por el backend', () => {
    assert.equal(GENERIC_PANEL_CONFIG.gaming.bodyKey, 'settings');
    assert.equal(GENERIC_PANEL_CONFIG.integrity.bodyKey, 'actions');
    assert.equal(GENERIC_PANEL_CONFIG.contextmenu.bodyKey, 'handlers');
    assert.equal(GENERIC_PANEL_CONFIG.oemdebloat.bodyKey, 'services');
    assert.equal(GENERIC_PANEL_CONFIG.timers.bodyKey, 'settings');
    assert.equal(GENERIC_PANEL_CONFIG.ghostdevices.bodyKey, 'devices');
    assert.equal(GENERIC_PANEL_CONFIG.searchindex.bodyKey, 'settings');
    assert.equal(GENERIC_PANEL_CONFIG.dnsflush.bodyKey, 'actions');
    assert.equal(GENERIC_PANEL_CONFIG.networkprivacy.bodyKey, 'settings');
    assert.equal(GENERIC_PANEL_CONFIG.pagefile.bodyKey, 'settings');
    assert.equal(GENERIC_PANEL_CONFIG.werfault.bodyKey, 'settings');
  });

  it('renderItem formatea adecuadamente los items', () => {
    const gamingItem = GENERIC_PANEL_CONFIG.gaming.renderItem({
      name: 'Game Mode',
      optimized: true,
      currentLabel: 'Activado (1)',
    });
    assert.equal(gamingItem.title, 'Game Mode');
    assert.ok(gamingItem.subtitle.includes('Ya optimizado'));

    const oemItem = GENERIC_PANEL_CONFIG.oemdebloat.renderItem({
      oem: 'Dell',
      name: 'Dell SupportAssist',
      desc: 'Telemetría',
      startMode: 'Auto',
    });
    assert.equal(oemItem.prefix, 'Dell');
    assert.equal(oemItem.title, 'Dell SupportAssist');
  });
});
