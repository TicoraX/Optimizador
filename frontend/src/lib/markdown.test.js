// node --test src/lib/markdown.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from './markdown.js';

test('escapa HTML crudo en nombres de apps y procesos', () => {
  const html = renderReport('- App: <img src=x onerror="alert(1)">');
  assert.ok(!html.includes('<img'), 'no debe emitir un <img> real');
  assert.match(html, /&lt;img/);
});

test('escapa bloques script', () => {
  const html = renderReport('<script>alert(1)</script>');
  assert.ok(!html.includes('<script'), 'no debe emitir un <script> real');
});

test('bloquea links con protocolo ejecutable', () => {
  const html = renderReport('[click](javascript:alert(1))');
  assert.ok(!html.includes('javascript:'), 'no debe conservar el href javascript:');
  assert.ok(!html.includes('<a '), 'no debe emitir un <a> para un href inseguro');
});

test('conserva links http normales', () => {
  const html = renderReport('[docs](https://example.com)');
  assert.match(html, /<a href="https:\/\/example\.com"/);
});

test('renderiza Markdown legitimo sin romperlo', () => {
  const html = renderReport('# Titulo\n\n- uno\n- dos\n\n```\nfoo\n```');
  assert.match(html, /<h1>Titulo<\/h1>/);
  assert.match(html, /<li>uno<\/li>/);
  assert.match(html, /<pre>/);
});
