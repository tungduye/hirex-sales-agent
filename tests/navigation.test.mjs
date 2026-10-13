import test from 'node:test';
import assert from 'node:assert/strict';
import { activeNavigationHref } from '../src/components/layout/navigation.ts';

const hrefs = ['/', '/companies', '/contacts', '/inbox', '/scan', '/campaigns', '/tasks', '/analytics', '/settings/automation', '/settings/ai-recruiter', '/documents', '/settings'];

test('exactly one item for every page, the most specific one', () => {
  const cases = {
    '/': '/', '/contacts': '/contacts', '/contacts/abc': '/contacts', '/inbox/all/123': '/inbox',
    '/settings': '/settings', '/settings/channels': '/settings', '/settings/human': '/settings',
    '/settings/ai-recruiter': '/settings/ai-recruiter', '/settings/automation/wf-1': '/settings/automation',
    '/campaigns/omnichannel/new': '/campaigns', '/scan/cv': '/scan',
  };
  for (const [path, expected] of Object.entries(cases)) assert.equal(activeNavigationHref(path, hrefs), expected, path);
});

test('prefix match respects path segments', () => {
  assert.equal(activeNavigationHref('/settingsx', hrefs), null);
  assert.equal(activeNavigationHref('/contactsimport', hrefs), null);
});

test('hidden items are not chosen', () => {
  const staffHrefs = hrefs.filter((href) => !href.startsWith('/settings/'));
  assert.equal(activeNavigationHref('/settings/ai-recruiter', staffHrefs), '/settings');
});
