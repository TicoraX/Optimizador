import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateModule, validateDate, validateBooleanField, validateIndexList,
  validateDays, validateMinRamMB, validateTime, validateFrequency,
  validateWeekdays, validateIntervalDays, normalizeSchTaskStatus,
  parseCsvLine, parseIndexSelection, padRight, VALID_MODULES,
} from '../lib/shared.js';

function expectError(fn, statusCode, msgPart) {
  try { fn(); assert.fail('should have thrown'); }
  catch (e) { assert.equal(e.statusCode, statusCode); assert.ok(e.message.includes(msgPart), `got: ${e.message}`); }
}

describe('validateModule', () => {
  for (const m of VALID_MODULES) {
    it(`accepts ${m}`, () => assert.doesNotThrow(() => validateModule(m)));
  }
  it('rejects invalid module', () => expectError(() => validateModule('nope'), 404, 'no permitido'));
});

describe('validateDate', () => {
  it('accepts valid date', () => assert.equal(validateDate('2026-06-23'), '2026-06-23'));
  it('rejects bad format', () => expectError(() => validateDate('2026/06/23'), 400, 'Formato'));
  it('rejects feb 30', () => expectError(() => validateDate('2026-02-30'), 400, 'no existe'));
  it('rejects wrong month range', () => expectError(() => validateDate('2026-13-01'), 400, 'no existe'));
  it('rejects past 2020', () => expectError(() => validateDate('2019-01-01'), 400, 'fuera de rango'));
});

describe('validateBooleanField', () => {
  it('accepts true', () => assert.equal(validateBooleanField(true, 'x'), true));
  it('accepts false', () => assert.equal(validateBooleanField(false, 'x'), false));
  it('rejects string', () => expectError(() => validateBooleanField('true', 'x'), 400, 'booleano'));
  it('rejects null', () => expectError(() => validateBooleanField(null, 'x'), 400, 'booleano'));
  it('rejects number', () => expectError(() => validateBooleanField(1, 'x'), 400, 'booleano'));
});

describe('validateIndexList', () => {
  it('accepts single', () => assert.equal(validateIndexList('3', 'p'), '3'));
  it('accepts multi', () => assert.equal(validateIndexList('1,3,5', 'p'), '1,3,5'));
  it('accepts empty', () => assert.equal(validateIndexList('', 'p'), ''));
  it('accepts todos', () => assert.equal(validateIndexList('todos', 'p'), 'todos'));
  it('accepts todos uppercase', () => assert.equal(validateIndexList('TODOS', 'p'), 'TODOS'));
  it('rejects non-string', () => expectError(() => validateIndexList(123, 'p'), 400, 'debe ser string'));
  it('rejects negative', () => expectError(() => validateIndexList('1,-2,3', 'p'), 400, 'separados por coma'));
  it('rejects letters', () => expectError(() => validateIndexList('1,a,3', 'p'), 400, 'separados por coma'));
});

describe('validateDays', () => {
  it('accepts 30', () => assert.equal(validateDays(30), 30));
  it('accepts 1', () => assert.equal(validateDays(1), 1));
  it('accepts 365', () => assert.equal(validateDays(365), 365));
  it('rejects 0', () => expectError(() => validateDays(0), 400, '1 y 365'));
  it('rejects 366', () => expectError(() => validateDays(366), 400, '1 y 365'));
  it('rejects float', () => expectError(() => validateDays(1.5), 400, 'entero'));
  it('rejects string', () => expectError(() => validateDays('a'), 400, 'entero'));
});

describe('validateMinRamMB', () => {
  it('accepts 50', () => assert.equal(validateMinRamMB(50), 50));
  it('rejects 5', () => expectError(() => validateMinRamMB(5), 400, '10 y 500'));
  it('rejects 501', () => expectError(() => validateMinRamMB(501), 400, '10 y 500'));
});

describe('validateTime', () => {
  it('accepts 09:00', () => assert.equal(validateTime('09:00'), '09:00'));
  it('accepts 23:59', () => assert.equal(validateTime('23:59'), '23:59'));
  it('rejects 24:00', () => expectError(() => validateTime('24:00'), 400, 'HH:MM'));
  it('rejects not string', () => expectError(() => validateTime(900), 400, 'HH:MM'));
});

describe('validateFrequency', () => {
  it('accepts daily', () => assert.equal(validateFrequency('daily'), 'daily'));
  it('accepts weekly', () => assert.equal(validateFrequency('weekly'), 'weekly'));
  it('rejects monthly', () => expectError(() => validateFrequency('monthly'), 400, 'daily'));
});

describe('validateWeekdays', () => {
  it('accepts valid days', () => assert.equal(validateWeekdays(['MON', 'WED']), 'MON,WED'));
  it('rejects empty', () => expectError(() => validateWeekdays([]), 400, 'al menos'));
  it('rejects invalid day', () => expectError(() => validateWeekdays(['MON', 'XXX']), 400, 'invalido'));
});

describe('validateIntervalDays', () => {
  it('accepts 3', () => assert.equal(validateIntervalDays(3), 3));
  it('rejects 0', () => expectError(() => validateIntervalDays(0), 400, '1 y 365'));
  it('rejects 366', () => expectError(() => validateIntervalDays(366), 400, '1 y 365'));
});

describe('normalizeSchTaskStatus', () => {
  it('ready en', () => assert.equal(normalizeSchTaskStatus('Ready'), 'Ready'));
  it('ready es', () => assert.equal(normalizeSchTaskStatus('Listo'), 'Ready'));
  it('ready fr', () => assert.equal(normalizeSchTaskStatus('Prêt'), 'Ready'));
  it('ready de', () => assert.equal(normalizeSchTaskStatus('Bereit'), 'Ready'));
  it('disabled en', () => assert.equal(normalizeSchTaskStatus('Disabled'), 'Disabled'));
  it('disabled es', () => assert.equal(normalizeSchTaskStatus('Deshabilitado'), 'Disabled'));
  it('running en', () => assert.equal(normalizeSchTaskStatus('Running'), 'Running'));
  it('running es', () => assert.equal(normalizeSchTaskStatus('En ejecución'), 'Running'));
  it('unknown', () => assert.equal(normalizeSchTaskStatus('SomeRandomStatus'), 'SomeRandomStatus'));
  it('strip quotes', () => assert.equal(normalizeSchTaskStatus('"Ready"'), 'Ready'));
});

describe('parseCsvLine', () => {
  it('simple', () => assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']));
  it('quoted', () => assert.deepEqual(parseCsvLine('"a b",c'), ['a b', 'c']));
  it('escaped quote', () => assert.deepEqual(parseCsvLine('"a""b",c'), ['a"b', 'c']));
  it('empty fields', () => assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c']));
});

describe('parseIndexSelection', () => {
  it('todos', () => assert.deepEqual(parseIndexSelection('todos', 5), [0, 1, 2, 3, 4]));
  it('specific', () => assert.deepEqual(parseIndexSelection('2,4', 5), [1, 3]));
  it('ignores out of range', () => assert.deepEqual(parseIndexSelection('1,99', 3), [0]));
  it('returns empty for null', () => assert.deepEqual(parseIndexSelection(null, 5), []));
});

describe('padRight', () => {
  it('pads', () => assert.equal(padRight('abc', 5), 'abc  '));
  it('handles null', () => assert.equal(padRight(null, 3), '   '));
  it('no truncate', () => assert.equal(padRight('abcdef', 3), 'abcdef'));
});