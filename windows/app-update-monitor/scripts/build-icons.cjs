const fs = require("node:fs");
const path = require("node:path");
const { Resvg } = require("@resvg/resvg-js");

// SVGs remain the editable source; each ICO frame is rendered at its own size.
const assets = path.resolve(process.argv[2] || path.join(__dirname, "..", "assets"));
const svg = fs.readFileSync(path.join(assets, "icon.svg"));
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = sizes.map(size => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const entry = 6 + 16 * i;
  header[entry] = sizes[i] === 256 ? 0 : sizes[i];
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
fs.writeFileSync(path.join(assets, "icon.ico"), Buffer.concat([header, ...frames]));
fs.writeFileSync(path.join(assets, "icon.png"), new Resvg(svg, { fitTo: { mode: "width", value: 512 } }).render().asPng());
const tray = fs.readFileSync(path.join(assets, "tray.svg"));
for (const [file, size] of [["tray.png", 16], ["tray@2x.png", 32], ["tray@3x.png", 48]]) {
  fs.writeFileSync(path.join(assets, file), new Resvg(tray, { fitTo: { mode: "width", value: size } }).render().asPng());
}
console.log(`Rendered 9 ICO sizes, PNG and tray images in ${assets}`);
