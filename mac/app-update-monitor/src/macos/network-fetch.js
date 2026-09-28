const fs = require('node:fs/promises');
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
function blockedByHosts(hostname, contents) {
  const target = hostname.toLowerCase().replace(/\.$/, '');
  return contents.split(/\r?\n/).some(line => {
    const [address, ...names] = line.split('#')[0].trim().split(/\s+/);
    return /^(?:127\.|0\.0\.0\.0$|::1$|::$)/.test(address) && names.some(name => name.toLowerCase().replace(/\.$/, '') === target);
  });
}
function createMacFetch({ net, readHosts = () => fs.readFile('/etc/hosts', 'utf8') }) {
  return async (input, options = {}) => {
    let url = new URL(input);
    const hosts = await readHosts();
    for (let count = 0; count < 6; count++) {
      options.signal?.throwIfAborted();
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('更新地址必须使用 HTTPS');
      // Respect explicit local blocks even when the system proxy resolves remote names.
      if (blockedByHosts(url.hostname, hosts)) throw new Error('更新地址已被本机 hosts 屏蔽');
      const response = await net.fetch(url.href, { ...options, credentials: 'omit', redirect: 'manual' });
      if (!REDIRECTS.has(response.status) || options.redirect === 'manual') return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || options.redirect === 'error') throw new Error('更新地址重定向无效');
      url = new URL(location, url);
    }
    throw new Error('更新地址重定向次数过多');
  };
}
module.exports = { createMacFetch, blockedByHosts };
