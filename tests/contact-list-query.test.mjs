import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_PAGE_SIZE, contactListHref, contactSearchPattern, normalizeContactListQuery, pageCount } from '../src/modules/crm/contacts/core/contact-list-query.ts';

test('defaults and validation', () => {
  assert.deepEqual(normalizeContactListQuery({}), { q: '', status: 'ALL', page: 1, pageSize: CONTACT_PAGE_SIZE });
  assert.deepEqual(normalizeContactListQuery({ q: '  Ánh  ', status: 'qualified', page: '3' }), { q: 'Ánh', status: 'QUALIFIED', page: 3, pageSize: CONTACT_PAGE_SIZE });
  assert.equal(normalizeContactListQuery({ status: 'HACKED' }).status, 'ALL');
  for (const page of ['0', '-2', 'abc', '']) assert.equal(normalizeContactListQuery({ page }).page, 1, page);
  assert.equal(normalizeContactListQuery({ q: ['a', 'b'] }).q, 'a');
  assert.equal(normalizeContactListQuery({ q: 'x'.repeat(500) }).q.length, 100);
});

test('search pattern cannot inject PostgREST syntax', () => {
  assert.equal(contactSearchPattern(''), null);
  assert.equal(contactSearchPattern('  '), null);
  assert.equal(contactSearchPattern('Nguyễn Văn A'), '*Nguyễn*Văn*A*');
  assert.equal(contactSearchPattern('a@b.com'), '*a@b.com*');
  const hostile = contactSearchPattern('x),id.eq.1,(full_name.ilike.%');
  assert.ok(!/[,()%]/.test(hostile), hostile);
  assert.equal(contactSearchPattern('%%,,'), null);
});

test('links keep only meaningful params', () => {
  assert.equal(contactListHref({ q: '', status: 'ALL', page: 1 }), '/contacts');
  assert.equal(contactListHref({ q: 'Lan Anh', status: 'NEW', page: 2 }), '/contacts?q=Lan+Anh&status=NEW&page=2');
});

test('page count', () => {
  assert.equal(pageCount(0, 50), 1);
  assert.equal(pageCount(8350, 50), 167);
  assert.equal(pageCount(50, 50), 1);
});
