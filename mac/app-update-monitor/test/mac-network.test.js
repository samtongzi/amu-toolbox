const test = require('node:test');
const assert = require('node:assert/strict');
const { createMacFetch } = require('../src/macos/network-fetch');
test('uses native system networking and respects hosts blocks before contacting proxy', async () => {
  const calls = [];
  const fetcher = createMacFetch({ readHosts: async () => '127.0.0.1 www.sublimetext.com blocked.example # retained\n::1 another.example', net: { fetch: async (...args) => { calls.push(args); return new Response('ok'); } } });
  assert.equal(await (await fetcher('https://macwhisper-site.vercel.app/appcast.xml')).text(), 'ok');
  assert.equal(calls[0][1].credentials, 'omit');
  for (const host of ['www.sublimetext.com', 'blocked.example', 'another.example']) await assert.rejects(fetcher(`https://${host}/`), /hosts/);
  assert.equal(calls.length, 1);
});
test('redirects cannot bypass local blocks or downgrade to HTTP', async () => {
  for (const location of ['https://blocked.example/feed', 'http://vendor.example/feed']) {
    let calls = 0;
    const fetcher = createMacFetch({ readHosts: async () => '0.0.0.0 blocked.example', net: { fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location } }); } } });
    await assert.rejects(fetcher('https://vendor.example/feed'), /hosts|HTTPS/);
    assert.equal(calls, 1);
  }
});
test('manual redirects and cancellation retain fetch semantics', async () => {
  let calls = 0;
  const fetcher = createMacFetch({ readHosts: async () => '', net: { fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/next' } }); } } });
  assert.equal((await fetcher('https://vendor.example/feed', { redirect: 'manual' })).status, 302);
  await assert.rejects(fetcher('https://vendor.example/feed', { signal: AbortSignal.abort() }));
  assert.equal(calls, 1);
});
