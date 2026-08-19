import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMicrosoftHandler,
  parseRegKeys,
  runContextMenuActionNative,
} from '../lib/contextmenu.js';

describe('Gestor de Menú Contextual (contextmenu.js)', () => {
  it('isMicrosoftHandler identifica handlers nativos protegidos', () => {
    assert.equal(isMicrosoftHandler('WorkFolders'), true);
    assert.equal(isMicrosoftHandler('EPP'), true);
    assert.equal(isMicrosoftHandler('Sharing'), true);
    assert.equal(isMicrosoftHandler('{a2a9545d-a0c2-42b4-9708-a0b2badd77c8}'), true);
    assert.equal(isMicrosoftHandler('7-Zip'), false);
    assert.equal(isMicrosoftHandler('WinRAR'), false);
    assert.equal(isMicrosoftHandler('Notepad++64'), false);
  });

  it('parseRegKeys extrae claves válidas desde stdout de reg query', () => {
    const raw = `
HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\EPP
HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\WinRAR
HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\7-Zip
`;
    const keys = parseRegKeys(raw);
    assert.equal(keys.length, 3);
    assert.ok(keys[0].includes('EPP'));
    assert.ok(keys[1].includes('WinRAR'));
  });

  it('runContextMenuActionNative en dryRun no realiza mutaciones destructivas', async () => {
    const logs = [];
    await runContextMenuActionNative({
      DRY_RUN: 'true',
      HANDLERS: 'HKCR\\*\\shellex\\ContextMenuHandlers\\WinRAR',
    }, (msg) => logs.push(msg));

    assert.ok(logs.some((l) => l.includes('Iniciando optimización del menú contextual')));
    assert.ok(logs.some((l) => l.includes('finalizada')));
  });
});
