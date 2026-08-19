import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedApp } from '../lib/apps.js';

describe('isProtectedApp', () => {
  it('protege runtimes cuya desinstalacion rompe otras apps', () => {
    for (const id of [
      'Microsoft.VCRedist.2015+.x64',
      'Microsoft.DotNet.Runtime.8',
      'Microsoft.WindowsAppRuntime.1.5',
      'Microsoft.UI.Xaml.2.8',
      'Microsoft.EdgeWebView2Runtime',
    ]) {
      assert.equal(isProtectedApp(id), true, `deberia proteger ${id}`);
    }
  });

  it('protege drivers de hardware', () => {
    assert.equal(isProtectedApp('Nvidia.GeForceExperience'), true);
    assert.equal(isProtectedApp('Intel.IntelDriverAndSupportAssistant'), true);
    assert.equal(isProtectedApp('Realtek.AudioDriver'), true);
  });

  it('protege el propio winget y su instalador', () => {
    assert.equal(isProtectedApp('Microsoft.AppInstaller'), false); // no esta en la lista
    assert.equal(isProtectedApp('Microsoft.DesktopAppInstaller'), true);
    assert.equal(isProtectedApp('Microsoft.Winget.Source'), true);
  });

  it('trata un id vacio como protegido (ante la duda, no se toca)', () => {
    assert.equal(isProtectedApp(''), true);
    assert.equal(isProtectedApp(null), true);
    assert.equal(isProtectedApp(undefined), true);
  });

  it('deja pasar aplicaciones normales', () => {
    for (const id of ['Valve.Steam', 'Discord.Discord', 'Spotify.Spotify', 'Notepad++.Notepad++']) {
      assert.equal(isProtectedApp(id), false, `no deberia proteger ${id}`);
    }
  });
});
