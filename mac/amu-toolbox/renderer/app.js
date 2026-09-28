const $ = selector => document.querySelector(selector);
let state = { apps: [], jobs: [], busy: false }, page = "store", category = "all", query = "", detailId = null, messageTimer;
let pending = new Set();
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const size = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const matches = app => !query || [app.name, app.description, app.category, ...app.features].join(" ").toLowerCase().includes(query);
const running = app => state.jobs.find(job => job.appId === app.id && job.status === "running");
const label = app => app.installed ? app.installed.needsUpdate ? "更新" : "打开" : "安装";
const action = app => app.installed && !app.installed.needsUpdate ? "launch" : "install";
const primary = app => {
  const job = running(app);
  if (job) return `<span class="action-progress">${escape(job.stage)} ${job.percent}%</span>`;
  const disabled = pending.has(app.id) || app.launching || (state.busy && action(app) === "install") || (!app.available && !app.installed);
  return `<button class="primary" data-action="${action(app)}" data-id="${app.id}" ${disabled ? "disabled" : ""}>${app.launching ? "启动中…" : label(app)}</button>`;
};

function empty(title, subtitle, button = false) {
  return `<div class="empty"><span class="empty-icon">◇</span><strong>${title}</strong><p>${subtitle}</p>${button ? '<button class="primary" data-page="store">去发现工具</button>' : ""}</div>`;
}
function notify(message, error = false) {
  clearTimeout(messageTimer);
  $("#message").textContent = message; $("#message").classList.toggle("error", error); $("#message").hidden = false;
  messageTimer = setTimeout(() => { $("#message").hidden = true; }, error ? 8500 : 3800);
}

function setPage(next) {
  if (!["store","library","downloads","about"].includes(next)) return;
  page = next;
  document.querySelectorAll(".page").forEach(element => { element.hidden = element.id !== page; });
  document.querySelectorAll(".nav-item").forEach(element => { element.classList.toggle("active", element.dataset.page === page); element.setAttribute("aria-current", element.dataset.page === page ? "page" : "false"); });
  const titles = { store:["工具商店","发现 / 精选工具"], library:["我的应用","属于你的 / 工具收藏"], downloads:["下载管理","安装与导出 / 任务记录"], about:["关于工具箱","阿木 / 为日常而做"] };
  $("#pageTitle").textContent = titles[page][0]; $("#breadcrumb").textContent = titles[page][1];
  $(".search").classList.toggle("search-hidden", page === "about" || page === "downloads");
  $("main").scrollTop = 0;
}

function render() {
  const mac = state.platform?.startsWith("macOS");
  document.body.classList.toggle("mac", !!mac);
  $(".sidebar-bottom > span").textContent = `v1.1.2 · ${mac ? "Apple Silicon" : "Windows"}`;
  $("#exportDescription").textContent = mac ? "安装包已内置，无需联网下载。选择“安装”保存到个人应用文件夹；选择“导出便携版”保存 ZIP，解压后可单独运行。" : "安装包已内置，无需联网下载。选择“安装”由工具箱管理；选择“导出便携版”保存可单独运行的 EXE 文件。";
  $("#installedCount").textContent = state.apps.filter(app => app.installed).length;
  $("#taskCount").hidden = !state.busy; $("#taskCount").textContent = state.busy ? "1" : "0";
  $("#catalogCount").textContent = `${state.apps.length} 款精选工具 · 安装包已内置`;
  const apps = state.apps.filter(app => matches(app) && (category === "all" || app.category === category));
  $("#catalog").innerHTML = apps.map(app => `<article class="app-card"><div class="card-top"><img class="app-icon" src="../assets/${app.icon}" alt=""><div><h3 class="app-name">${escape(app.name)}</h3><span class="category-label">${escape(app.category)}${app.installed ? ' <span class="installed-label">· 已安装</span>' : ""}</span></div></div><p class="card-description">${escape(app.description)}</p><div class="card-meta"><span>v${escape(app.version)}</span><span>${size(app.size)}</span><span>${escape(state.platform || "Windows")}</span></div>${!app.available ? '<p class="inline-notice">内置安装包缺失，请重新获取完整工具箱。</p>' : ""}<div class="card-actions"><button class="text-button" data-action="detail" data-id="${app.id}">了解更多 ↗</button>${primary(app)}</div></article>`).join("") || empty("没有找到相关工具", "试试搜索“更新”或“提醒”，也可以换个分类。");
  const installed = state.apps.filter(app => app.installed && matches(app));
  $("#libraryList").innerHTML = installed.map(app => `<article class="library-item"><img class="app-icon" src="../assets/${app.icon}" alt=""><div class="info"><h3 class="app-name">${escape(app.name)}</h3><p>v${escape(app.installed.version)} · ${size(app.installed.size)}${app.installed.needsUpdate ? " · 有可用更新" : " · 已安装"}</p></div><div class="library-actions"><button class="text-button" data-action="detail" data-id="${app.id}">详情</button><button class="text-button danger" data-action="uninstall" data-id="${app.id}" ${state.busy || pending.has(app.id) ? "disabled" : ""}>卸载</button>${primary(app)}</div></article>`).join("") || empty(query ? "没有匹配的已安装工具" : "这里，留给你的常用工具", query ? "换个关键词再试试。" : "去工具商店选择需要的应用，安装后就会出现在这里。", !query);
  const typeNames = { install:"安装", export:"导出便携版", uninstall:"卸载" };
  $("#jobs").innerHTML = state.jobs.map(job => { const app = state.apps.find(app => app.id === job.appId); return `<article class="job"><div class="job-header"><img src="../assets/${app.icon}" alt=""><div class="job-info"><strong>${escape(job.name)}</strong><p>${typeNames[job.type]} · ${new Date(job.startedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}</p></div><span class="job-state ${job.status}">${escape(job.stage)}${job.status === "running" ? ` ${job.percent}%` : ""}</span></div>${job.status === "running" ? `<progress max="100" value="${job.percent}" aria-label="${typeNames[job.type]}进度"></progress>` : ""}${job.error ? `<p class="job-error">${escape(job.error)}</p>` : ""}<div class="job-footer">${job.cancellable ? '<button class="text-button" data-action="cancel">取消任务</button>' : ""}${job.status === "completed" && job.type === "export" ? `<button class="text-button" data-action="show-export" data-id="${job.id}">查看文件 ↗</button>` : ""}</div></article>`; }).join("") || empty("还没有下载任务", "安装工具或导出便携版后，进度和结果会显示在这里。", true);
  if (detailId) renderDetail();
}

function renderDetail() {
  const app = state.apps.find(app => app.id === detailId);
  if (!app) return;
  $("#detailContent").innerHTML = `<div class="detail-header"><button class="detail-close" data-action="close-detail" aria-label="关闭详情">×</button><div class="card-top"><img class="app-icon" src="../assets/${app.icon}" alt=""><div><h2 class="app-name" id="detailTitle">${escape(app.name)}</h2><span class="category-label">${escape(app.category)} · v${escape(app.version)}</span></div></div><p>${escape(app.tagline)}</p></div><div class="detail-body"><h3>它能帮你做什么</h3><ul class="feature-list">${app.features.map(feature => `<li>${escape(feature)}</li>`).join("")}</ul><h3>使用方式</h3><p class="detail-note">${escape(app.usage)}</p><h3>运行要求</h3><p class="detail-note">${escape(app.requirements)}</p>${app.installed ? `<button class="text-button" data-action="show-folder" data-id="${app.id}">打开安装位置 ↗</button>` : ""}<div class="detail-bottom"><span class="detail-size">${size(app.size)} · 独立应用</span><div><button class="text-button" data-action="export" data-id="${app.id}" ${state.busy || !app.available || pending.has(app.id) ? "disabled" : ""}>导出便携版</button> &nbsp; ${primary(app)}</div></div></div>`;
  $("#detail").setAttribute("aria-labelledby", "detailTitle");
}

async function perform(name, id) {
  if (name === "detail") { detailId = id; renderDetail(); $("#detail").showModal(); return; }
  if (name === "close-detail") { $("#detail").close(); return; }
  if (pending.has(id)) return;
  pending.add(id); render();
  try {
    let result;
    if (name === "install") { result = await window.toolbox.install(id); notify(result?.cancelled ? "安装已取消。" : "安装完成，可以在“我的应用”中打开。"); }
    else if (name === "launch") { await window.toolbox.launch(id); notify(state.platform?.startsWith("macOS") ? "已启动。常驻工具可在屏幕顶部菜单栏找到。" : "已启动。常驻工具可在右下角托盘中找到。"); }
    else if (name === "export") { result = await window.toolbox.export(id); if (!result?.cancelled) notify("便携版已保存，可独立运行或复制到其他电脑。"); }
    else if (name === "uninstall") { result = await window.toolbox.uninstall(id); if (!result?.cancelled) notify("已卸载，工具配置和历史记录已保留。"); }
    else if (name === "cancel") await window.toolbox.cancel();
    else if (name === "show-folder") await window.toolbox.showFolder(id);
    else if (name === "show-export") await window.toolbox.showExport(id);
  } catch (error) { notify(error.message, true); }
  finally { pending.delete(id); try { state = await window.toolbox.state(); render(); } catch (error) { notify(error.message, true); } }
}

document.addEventListener("click", event => {
  const target = event.target.closest("button");
  if (!target || target.disabled) return;
  if (target.dataset.page) setPage(target.dataset.page);
  else if (target.dataset.category) { category = target.dataset.category; document.querySelectorAll("[data-category]").forEach(button => button.classList.toggle("active", button.dataset.category === category)); render(); }
  else if (target.dataset.action) void perform(target.dataset.action, target.dataset.id);
});
$(".brand").addEventListener("click", event => { event.preventDefault(); setPage("store"); });
$("#search").addEventListener("input", event => { query = event.target.value.trim().toLowerCase(); render(); });
$("#browse").addEventListener("click", () => $(".section-heading").scrollIntoView({ behavior: "smooth", block: "start" }));
$("#detail").addEventListener("close", () => { detailId = null; });
const wallets = {
  alipay: { title: "支付宝扫一扫", image: "support-alipay.jpg", alt: "三木的支付宝收款二维码" },
  wechat: { title: "微信扫一扫", image: "support-wechat.jpg", alt: "三木的微信收款二维码" }
};
document.querySelectorAll("[data-wallet]").forEach(button => button.addEventListener("click", () => {
  const wallet = button.dataset.wallet;
  const content = wallets[wallet];
  if (!content) return;
  $("#supportZoomTitle").textContent = content.title;
  $("#supportZoomCrop").className = `qr-crop qr-${wallet}`;
  $("#supportZoomImage").src = `../assets/${content.image}`;
  $("#supportZoomImage").alt = content.alt;
  $("#supportZoom").showModal();
}));
$("#closeSupportZoom").addEventListener("click", () => $("#supportZoom").close());
$("#installationFolder").addEventListener("click", () => { void window.toolbox.installationFolder().catch(error => notify(error.message, true)); });
window.toolbox.onState(next => { state = next; render(); });
window.toolbox.state().then(next => { state = next; $("#loading").hidden = true; render(); setPage("store"); })
  .catch(error => { $("#loading").textContent = "工具库加载失败，请关闭后重新打开。"; notify(error.message, true); });
