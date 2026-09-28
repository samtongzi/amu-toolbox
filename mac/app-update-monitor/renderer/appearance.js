(() => {
  const select = document.getElementById('appearance');
  const status = document.getElementById('appearanceStatus');
  let current = { mode: 'system', dark: matchMedia('(prefers-color-scheme: dark)').matches };
  function apply(next) {
    current = next;
    document.documentElement.dataset.theme = next.dark ? 'dark' : 'light';
    select.value = next.mode;
  }
  apply(current);
  window.appearanceApi.onChanged(apply);
  select.disabled = true;
  window.appearanceApi.get().then(apply).catch(() => { status.textContent = '无法读取外观设置'; })
    .finally(() => { select.disabled = false; });
  select.addEventListener('change', async () => {
    select.disabled = true;
    status.textContent = '正在保存…';
    try {
      apply(await window.appearanceApi.set(select.value));
      status.textContent = '已保存';
    } catch {
      apply(current);
      status.textContent = '保存失败，请重试';
    } finally { select.disabled = false; }
  });
})();
