// 迁移历史遗留的「u-<id>/…」上传目录到现在的「用户上传/<昵称>/…」结构。
//
// 背景：早期版本把每个用户的上传直接放在盘的 u-<用户 id>/ 下，不带月份子目录，
// 也不按昵称分类；后来改成 upload.root/<昵称>/<YYYY-MM>。这个脚本把旧记录搬到新位置，
// 同步更新 media 表里的 path，处理重名，并把空掉的旧目录删掉。
//
// 用法：
//   node scripts/migrate-legacy.mjs            # 只报告，不移动（默认）
//   node scripts/migrate-legacy.mjs --apply    # 真正执行
//   node scripts/migrate-legacy.mjs --apply --drive=1
//   加 --json 输出机器可读结果。
//
// 集群里跑：kubectl 之类不方便时，用同镜像起一个 Job，挂同一个 PVC，
// 环境变量给 DATA_DIR=/data DIST_DIR=/app/dist，命令 node scripts/migrate-legacy.mjs --apply

import path from "node:path";
import { all, get, run } from "../server/db.mjs";
import { driverFor } from "../server/drives.mjs";
import { userFolder } from "../server/media.mjs";
import { paths } from "../server/config.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asJson = args.includes("--json");
const driveArg = args.find((arg) => arg.startsWith("--drive="));
const onlyDrive = driveArg ? Number(driveArg.slice("--drive=".length)) : null;

const legacyPattern = /^u-(\d+)(?:\/(.*))?$/;

// 管理员的新上传落在 admin/<YYYY-MM>，历史文件也归到同一处，避免两套目录并存
const isAdminUser = (user) => user.role === "admin" || user.role === "owner";
const adminFolder = (createdAt) => `admin/${String(createdAt || new Date().toISOString()).slice(0, 7)}`;

const uniqueTarget = async (driver, dir, name) => {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; index < 200; index += 1) {
    const candidate = index === 1 ? name : `${stem}-${index}${ext}`;
    const existing = await driver.stat(`${dir}/${candidate}`);
    if (!existing) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
};

const parentOf = (target) => {
  const cleaned = String(target).replace(/^\/+/, "");
  const dir = path.posix.dirname(cleaned);
  return dir === "." ? "/" : `/${dir}`;
};

async function main() {
  const report = { mode: apply ? "apply" : "dry-run", scanned: 0, moved: 0, missing: 0, skipped: 0, items: [], errors: [] };

  const rows = onlyDrive
    ? all("SELECT * FROM media WHERE drive_id = ? ORDER BY id", onlyDrive)
    : all("SELECT * FROM media ORDER BY drive_id, id");
  report.scanned = rows.length;

  const drives = new Map();
  for (const drive of all("SELECT * FROM drives")) drives.set(drive.id, drive);

  for (const row of rows) {
    // 记录里的 path 通常带前导斜杠（/u-3/2026-10/a.jpg），比较前先去掉
    const rel = String(row.path || "").replace(/^\/+/, "");
    const match = legacyPattern.exec(rel);
    if (!match) continue;

    const ownerId = Number(match[1]);
    const rest = String(match[2] || "").trim();
    const drive = drives.get(row.drive_id);
    if (!drive) {
      report.skipped += 1;
      report.items.push({ id: row.id, path: row.path, result: "skip", reason: "存储已不存在" });
      continue;
    }

    const owner = row.owner_id ? get("SELECT * FROM users WHERE id = ?", row.owner_id) : null;
    const user = owner || get("SELECT * FROM users WHERE id = ?", ownerId);
    if (!user) {
      report.skipped += 1;
      report.items.push({ id: row.id, path: row.path, result: "skip", reason: "用户不存在" });
      continue;
    }

    const folder = isAdminUser(user) ? adminFolder(row.created_at) : userFolder(user);
    const fileDir = rest ? path.posix.dirname(rest) : "";
    const dir = fileDir && fileDir !== "." ? `${folder}/${fileDir}` : folder;
    const name = path.posix.basename(row.path);

    let driver;
    try {
      driver = driverFor(drive);
    } catch (error) {
      report.errors.push({ id: row.id, path: row.path, error: String(error?.message || error) });
      continue;
    }

    const source = await driver.stat(row.path).catch(() => null);
    if (!source) {
      report.missing += 1;
      report.items.push({ id: row.id, path: row.path, result: "missing", target: `${dir}/${name}` });
      // 文件已经不在了：只在 apply 时把记录清掉，避免前台一直挂着破图
      if (apply) {
        run("DELETE FROM media WHERE id = ?", row.id);
        report.items.at(-1).result = "missing-purged";
      }
      continue;
    }

    const finalName = await uniqueTarget(driver, dir, name);
    const target = `${dir === "/" ? "" : dir}/${finalName}`;

    if (target === row.path) {
      report.skipped += 1;
      report.items.push({ id: row.id, path: row.path, result: "same" });
      continue;
    }

    if (!apply) {
      report.items.push({ id: row.id, path: row.path, target, result: "plan" });
      continue;
    }

    try {
      await driver.ensureDir(dir);
      await driver.move(row.path, dir === "/" ? "/" : dir);
      run("UPDATE media SET path = ?, name = ? WHERE id = ?", target, finalName, row.id);
      report.moved += 1;
      report.items.push({ id: row.id, path: row.path, target, result: "moved" });
    } catch (error) {
      report.errors.push({ id: row.id, path: row.path, target, error: String(error?.message || error) });
    }
  }

  // 搬完之后，把空掉的旧 u-<id> 目录删掉：先自底向上清空子目录，再删空的根目录
  const emptied = [];
  if (apply) {
    const pruneDir = async (driver, dir) => {
      const children = await driver.list(dir).catch(() => null);
      if (!children) return false;
      for (const child of children) {
        if (!child.isDir) return false;
      }
      let empty = true;
      for (const child of children) {
        const childEmpty = await pruneDir(driver, child.path);
        if (!childEmpty) empty = false;
      }
      if (!empty) return false;
      await driver.remove(dir).catch(() => {});
      return true;
    };

    for (const drive of drives.values()) {
      let driver;
      try {
        driver = driverFor(drive);
      } catch {
        continue;
      }
      for (const entry of all("SELECT DISTINCT owner_id FROM media WHERE drive_id = ?", drive.id)) {
        const owner = entry.owner_id ? get("SELECT * FROM users WHERE id = ?", entry.owner_id) : null;
        if (!owner) continue;
        for (const candidate of new Set([`u-${owner.id}`, `u-${owner.id}/${owner.id}`])) {
          const exists = await driver.stat(`/${candidate}`).catch(() => null);
          if (!exists || !exists.isDir) continue;
          const gone = await pruneDir(driver, `/${candidate}`);
          if (gone) emptied.push(`drive-${drive.id}:/${candidate}`);
        }
      }
    }
  }

  report.emptied = emptied;
  report.db = path.relative(process.cwd(), paths.db) || paths.db;

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  const head = apply ? "执行迁移" : "试运行（不会改动任何文件）";
  console.log(`${head}：共检查 ${report.scanned} 条媒体记录`);
  for (const item of report.items) {
    const tail = item.target ? `→ ${item.target}` : item.reason ? `（${item.reason}）` : "";
    console.log(`  ${String(item.result).padEnd(14)} ${item.path} ${tail}`);
  }
  if (report.emptied.length) console.log(`已清理空目录：${report.emptied.join("、")}`);
  for (const error of report.errors) console.log(`  错误 ${error.path || error.id}: ${error.error}`);
  console.log(
    `结果：移动 ${report.moved}，缺失 ${report.missing}，跳过 ${report.skipped}，错误 ${report.errors.length}` +
      (apply ? "" : "（加 --apply 才会真的移动）"),
  );
  return report;
}

main().then(
  (report) => {
    if (!apply && report.items.some((item) => item.result === "plan")) process.exitCode = 2;
  },
  (error) => {
    console.error("迁移失败：", error?.stack || error);
    process.exitCode = 1;
  },
);