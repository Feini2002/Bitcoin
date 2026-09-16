const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildPages } = require("./build-pages.cjs");
const ROOT = path.resolve(__dirname, "..");
const TEMP = path.join(ROOT, ".artifacts");
fs.mkdirSync(TEMP, { recursive: true });
const fixture = fs.mkdtempSync(path.join(TEMP, "pages-fixture-"));
let passed = 0;
function check(name, action) { action(); passed++; console.log("PASS " + name); }
function write(relative, content) {
  const file = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function list(dir, prefix = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    return entry.isDirectory() ? list(path.join(dir, entry.name), relative + "/") : [relative];
  }).sort();
}
try {
  write("config/pages-assets.json", JSON.stringify({files:["index.html", "styles.css"],directories:[{path:"js",extensions:[".js"]}]}));
  write("index.html", '<link href="styles.css?v=1"><script src="js/app.js?v=1"></script>');
  write("styles.css", "body{}");
  write("js/app.js", "window.fixture=true;");
  write("js/notes.md", "development notes");
  // 全部为本测试创建的虚构样例，不读取工作区真实环境文件。
  for (const rel of [".env", ".codex-bridge.env", "cloudflare/worker.js", "docs/internal.md", "archive/old.js", "scripts/test.cjs"]) write(rel, "test-only sentinel");
  const first = buildPages(fixture);
  check("FILES-01 only declared runtime assets are copied", () => assert.deepEqual(list(first.output), ["index.html", "js/app.js", "styles.css"]));
  write("dist/pages/old.js", "obsolete output");
  buildPages(fixture);
  check("FILES-02 rebuilding removes stale output without touching sources", () => { assert(!fs.existsSync(path.join(first.output,"old.js"))); assert(fs.existsSync(path.join(fixture,"docs/internal.md"))); });
  write("index.html", '<script src="missing.js"></script>');
  check("FILES-03 undeclared entry dependency fails before replacing output", () => { assert.throws(() => buildPages(fixture), /Unlisted page asset/); assert(fs.existsSync(path.join(first.output,"js/app.js"))); });
  write("index.html", '<SCRIPT SRC = "missing.js"></SCRIPT>');
  check("FILES-07 spaced uppercase resource attributes are checked", () => assert.throws(() => buildPages(fixture), /Unlisted page asset/));
  write("index.html", '<script src=missing.js></script>');
  check("FILES-08 unquoted resource attributes are checked", () => assert.throws(() => buildPages(fixture), /Unlisted page asset/));
  write("index.html", '<script src="js/app.js"></script>');
  const oldBytes = fs.readFileSync(path.join(first.output, "index.html"), "utf8");
  check("FILES-09 copy failure preserves complete previous artifact", () => {
    const copy = fs.copyFileSync;
    fs.copyFileSync = (source, target) => {
      if (source === path.join(fixture, "js/app.js")) throw new Error("injected copy failure");
      return copy(source, target);
    };
    try { assert.throws(() => buildPages(fixture), /injected copy failure/); }
    finally { fs.copyFileSync = copy; }
    assert.equal(fs.readFileSync(path.join(first.output,"index.html"),"utf8"), oldBytes);
    assert.deepEqual(list(first.output), ["index.html", "js/app.js", "styles.css"]);
    assert.deepEqual(fs.readdirSync(path.join(fixture,"dist")), ["pages"]);
  });
  check("FILES-10 failed replacement restores previous artifact", () => {
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (path.basename(source) === "next") throw new Error("injected rename failure");
      return rename(source, target);
    };
    try { assert.throws(() => buildPages(fixture), /injected rename failure/); }
    finally { fs.renameSync = rename; }
    assert.equal(fs.readFileSync(path.join(first.output,"index.html"),"utf8"), oldBytes);
    assert.deepEqual(fs.readdirSync(path.join(fixture,"dist")), ["pages"]);
  });
  buildPages(fixture);
  check("FILES-11 successful rebuild installs new content", () => assert.equal(fs.readFileSync(path.join(first.output,"index.html"),"utf8"), '<script src="js/app.js"></script>'));
  check("FILES-12 replacement and restore failure retain recoverable old artifact", () => {
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (["next", "previous"].includes(path.basename(source))) throw new Error("injected replacement and restore failure");
      return rename(source, target);
    };
    try { assert.throws(() => buildPages(fixture), /previous artifact retained at/); }
    finally { fs.renameSync = rename; }
    const staging = fs.readdirSync(path.join(fixture,"dist")).find(name => name.startsWith(".pages-build-"));
    assert(staging);
    const recovery = path.join(fixture,"dist",staging,"previous");
    assert.deepEqual(list(recovery), ["index.html", "js/app.js", "styles.css"]);
    assert.equal(fs.readFileSync(path.join(recovery,"index.html"),"utf8"), '<script src="js/app.js"></script>');
  });
  const actual = buildPages(ROOT);
  check("FILES-04 repository artifact exactly matches its asset list", () => assert.deepEqual(list(actual.output), actual.files));
  check("FILES-05 legacy Chinese entry remains a redirect", () => assert.match(fs.readFileSync(path.join(actual.output,"Bit交易决策平台.html"),"utf8"), /index.html/));
  check("FILES-06 no development directories are shipped", () => assert(actual.files.every(file => file.startsWith("js/") || ["index.html","Bit交易决策平台.html","styles.css","btc.svg"].includes(file))));
  console.log("Pages artifact: " + actual.files.length + " runtime files, " + passed + " PASS / 0 FAIL");
} finally {
  const resolved = path.resolve(fixture);
  if (path.dirname(resolved) !== path.resolve(TEMP) || !path.basename(resolved).startsWith("pages-fixture-")) throw new Error("Unexpected fixture cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
}
