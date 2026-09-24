import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { checkCredentials } from '../src/auth.js';

test('login: username tidak peka huruf besar, password harus persis', () => {
  config.adminUser = 'admin';
  config.adminPassword = 'Rahasia123';
  assert.equal(checkCredentials('Admin ', 'Rahasia123'), true);
  assert.equal(checkCredentials('admin', 'rahasia123'), false);
  assert.equal(checkCredentials('orang', 'Rahasia123'), false);
  assert.equal(checkCredentials(undefined, undefined), false);
});
