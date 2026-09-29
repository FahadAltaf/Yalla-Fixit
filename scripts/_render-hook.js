/* Throwaway: let ts-node load the page's image and font imports. */
const path = require("path");
for (const ext of [".png", ".jpg", ".jpeg", ".svg", ".webp"]) {
  require.extensions[ext] = function (module, filename) {
    const rel = filename.split("public").pop().replace(/\/g, "/");
    module.exports = { default: { src: rel, width: 800, height: 600 } };
    module.exports.default.toString = () => rel;
    Object.assign(module.exports, module.exports.default);
  };
}
/* next/font/google runs a loader at build time; a plain className is all
   the page needs to render. */
const Module = require("module");
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/font/google") {
    return new Proxy({}, { get: () => () => ({ className: "font", style: {} }) });
  }
  return load.apply(this, arguments);
};
