const fs = require("node:fs");
const { Resvg } = require("@resvg/resvg-js");
const roots = [".", "../codex-reset-notifier"];
const images = roots.map(root => fs.readFileSync(`${root}/assets/icon.png`).toString("base64"));
const labels = ["App 更新监测器", "Codex 额度重置通知"];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="290">
  <rect width="720" height="290" rx="22" fill="#f0f3fa"/>
  ${images.map((image, index) => `<image x="${92 + index * 360}" y="25" width="176" height="176" href="data:image/png;base64,${image}"/>
  <text x="${180 + index * 360}" y="241" text-anchor="middle" font-family="Microsoft YaHei" font-size="19" fill="#24324b">${labels[index]}</text>`).join("")}
</svg>`;
fs.writeFileSync("release/icons-preview.png", new Resvg(svg).render().asPng());
