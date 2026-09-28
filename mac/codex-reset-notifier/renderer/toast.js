const card = document.querySelector(".toast");
const title = document.getElementById("title");
const body = document.getElementById("body");
let hovering = false;
let keyboardFocus = false;
const updateTimer = () => hovering || keyboardFocus ? window.toast.pause() : window.toast.resume();

window.toast.onContent(content => {
  document.body.classList.toggle("acrylic", content.acrylic);
  title.textContent = content.title;
  body.textContent = content.body;
  title.title = content.title;
  body.title = content.body;
  requestAnimationFrame(() => window.toast.ready(Math.ceil(card.getBoundingClientRect().height)));
});
window.toast.onOpenFailed(() => {
  document.getElementById("hint").textContent = "打开失败，请重试";
});
document.getElementById("close").addEventListener("click", () => window.toast.close());
for (const id of ["content", "open"]) document.getElementById(id).addEventListener("click", () => window.toast.open());
document.addEventListener("keydown", event => {
  if (event.key === "Escape") window.toast.close();
});
card.addEventListener("mouseenter", () => { hovering = true; updateTimer(); });
card.addEventListener("mouseleave", () => { hovering = false; updateTimer(); });
document.addEventListener("focusin", () => { keyboardFocus = true; updateTimer(); });
window.addEventListener("blur", () => { keyboardFocus = false; updateTimer(); });
