const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

function within(base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base) + path.sep)) throw new Error("Asset path outside root: " + relative);
  return target;
}

function listPagesFiles(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "config/pages-assets.json"), "utf8"));
  const files = new Set(manifest.files);
  function visit(relative, extensions) {
    for (const entry of fs.readdirSync(within(root, relative), { withFileTypes: true })) {
      const child = relative + "/" + entry.name;
      if (entry.isDirectory()) visit(child, extensions);
      else if (entry.isFile() && extensions.includes(path.extname(entry.name))) files.add(child);
    }
  }
  for (const dir of manifest.directories) visit(dir.path, dir.extensions);
  const result = [...files].sort();
  for (const relative of result) {
    if (!fs.statSync(within(root, relative)).isFile()) throw new Error("Missing asset: " + relative);
  }
  // 入口引用的本地资源必须包含在发布清单中，防止构建后缺脚本或样式。
  for (const relative of result.filter(file => file.endsWith(".html"))) {
    const html = fs.readFileSync(within(root, relative), "utf8");
    for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const ref = (match[1] ?? match[2] ?? match[3]).trim();
      if (!ref) continue;
      if (/^[a-z]+:/i.test(ref) || ref.startsWith("//") || ref.startsWith("#")) continue;
      const asset = decodeURIComponent(new URL(ref, "https://assets.local/" + relative).pathname).slice(1);
      if (!files.has(asset)) throw new Error("Unlisted page asset: " + relative + " -> " + asset);
    }
  }
  return result;
}

// Windows 在刚移走目录后可能短暂返回 EPERM；最多等待 200ms，持续失败交给恢复逻辑。
function moveDirectory(source, target) {
  for (let attempt = 0; ; attempt++) {
    try { return fs.renameSync(source, target); }
    catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes(error.code) || attempt === 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function buildPages(root = ROOT) {
  const files = listPagesFiles(root);
  // 固定可再生目录；在任何递归清理之前核对其绝对路径仍在本次 root 内。
  const output = within(root, "dist/pages");
  const dist = within(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const staging = fs.mkdtempSync(within(dist, ".pages-build-"));
  const next = within(staging, "next");
  const previous = within(staging, "previous");
  fs.mkdirSync(next);
  let movedPrevious = false;
  let preserveRecovery = false;
  try {
    for (const relative of files) {
      const target = within(next, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(within(root, relative), target);
    }
    if (fs.existsSync(output)) {
      moveDirectory(output, previous);
      movedPrevious = true;
    }
    try {
      moveDirectory(next, output);
    } catch (error) {
      if (movedPrevious) {
        try { moveDirectory(previous, output); }
        catch (restoreError) {
          preserveRecovery = true;
          throw new AggregateError([error, restoreError], "Cannot restore Pages output; previous artifact retained at " + previous);
        }
      }
      throw error;
    }
  } finally {
    // staging 由本次 mkdtemp 创建；恢复失败时保留旧产物并报告精确位置。
    if (!preserveRecovery) fs.rmSync(within(dist, path.basename(staging)), { recursive: true, force: true });
  }
  return { output, files };
}

if (require.main === module) {
  const result = buildPages();
  console.log("PASS Pages artifact: " + result.files.length + " files -> " + result.output);
}
module.exports = { buildPages, listPagesFiles };
