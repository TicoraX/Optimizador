import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseScQc, isSystemServicePath } from '../lib/services.js';

// Salida real de `sc qc Spooler` en Windows 11.
const SC_QC_SPOOLER = `[SC] QueryServiceConfig SUCCESS

SERVICE_NAME: Spooler
        TYPE               : 110  WIN32_OWN_PROCESS (interactive)
        START_TYPE         : 2   AUTO_START
        ERROR_CONTROL      : 1   NORMAL
        BINARY_PATH_NAME   : C:\\WINDOWS\\System32\\spoolsv.exe
        LOAD_ORDER_GROUP   : SpoolerGroup
        TAG                : 0
        DISPLAY_NAME       : Print Spooler
        DEPENDENCIES       : RPCSS
        SERVICE_START_NAME : LocalSystem
`;

const SC_QC_THIRD_PARTY = `[SC] QueryServiceConfig SUCCESS

SERVICE_NAME: Steam Client Service
        TYPE               : 10  WIN32_OWN_PROCESS
        START_TYPE         : 3   DEMAND_START
        ERROR_CONTROL      : 1   NORMAL
        BINARY_PATH_NAME   : C:\\Program Files (x86)\\Common Files\\Steam\\steamservice.exe
        DISPLAY_NAME       : Steam Client Service
        SERVICE_START_NAME : LocalSystem
`;

describe('parseScQc', () => {
  it('extrae el tipo de arranque para poder revertir', () => {
    const info = parseScQc(SC_QC_SPOOLER);
    assert.equal(info.startTypeCode, 2);
    assert.equal(info.name, 'Spooler');
    assert.equal(info.displayName, 'Print Spooler');
  });

  it('conserva rutas con espacios y parentesis', () => {
    const info = parseScQc(SC_QC_THIRD_PARTY);
    assert.equal(info.binaryPath, 'C:\\Program Files (x86)\\Common Files\\Steam\\steamservice.exe');
    assert.equal(info.startTypeCode, 3);
  });

  it('devuelve null si el servicio no existe', () => {
    assert.equal(parseScQc('[SC] OpenService FAILED 1060'), null);
  });
});

describe('isSystemServicePath', () => {
  it('protege binarios del arbol de Windows', () => {
    assert.equal(isSystemServicePath('C:\\WINDOWS\\System32\\spoolsv.exe'), true);
    assert.equal(isSystemServicePath('C:\\Windows\\WinSxS\\foo.exe'), true);
  });

  it('trata una ruta vacia como del sistema (no se toca lo que no se puede verificar)', () => {
    assert.equal(isSystemServicePath(''), true);
    assert.equal(isSystemServicePath(null), true);
  });

  it('deja pasar servicios de terceros', () => {
    assert.equal(isSystemServicePath('C:\\Program Files (x86)\\Common Files\\Steam\\steamservice.exe'), false);
  });

  // Caso real encontrado escaneando la maquina: WinDefend aparecia en la lista
  // de terceros porque su binario no vive bajo \windows\.
  it('protege Windows Defender pese a que su ruta no esta en el arbol de Windows', () => {
    const defenderPath = 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18.25\\MsMpEng.exe';
    assert.equal(isSystemServicePath(defenderPath, 'WinDefend'), true, 'por nombre');
    assert.equal(isSystemServicePath(defenderPath, ''), true, 'por ruta');
  });

  it('protege por nombre servicios criticos aunque la ruta parezca de terceros', () => {
    for (const name of ['wuauserv', 'MpsSvc', 'BFE', 'RpcSs', 'Schedule']) {
      assert.equal(
        isSystemServicePath('C:\\Program Files\\Cualquiera\\svc.exe', name), true,
        `deberia proteger ${name}`,
      );
    }
  });

  it('la proteccion por nombre no distingue mayusculas', () => {
    assert.equal(isSystemServicePath('C:\\App\\x.exe', 'WINDEFEND'), true);
  });
});
