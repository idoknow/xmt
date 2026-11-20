// 截图前的静态预览：复制 dist，并关掉动画，避免截图抓到 opacity:0 的中间帧
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const from = path.join(root, "dist");
const to = path.join(root, ".tmp", "preview");
const shot = process.env.SHOT || "";

const shotScript = shot
  ? `<script>addEventListener("load",()=>{${
      shot === "theme" ? 'document.querySelectorAll("details[data-theme-box]").forEach((d)=>{d.open=true;});' : ""
    }${
      shot === "profile" ? 'document.querySelectorAll("details[data-profile]").forEach((d)=>{d.open=true;});' : ""
    }});</script>\n</body>`
  : "";

async function copy(dir, base) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    const out = path.join(to, rel);
    if (entry.isDirectory()) {
      await mkdir(out, { recursive: true });
      await copy(abs, base);
      continue;
    }
    let buf = await readFile(abs);
    if (entry.name.endsWith(".html")) {
      const inject =
        "<style>*,*::before,*::after{animation:none!important;transition:none!important}" +
        ".reveal{opacity:1!important;transform:none!important}" +
        ".emblem img,.emblem::before,.emblem::after{opacity:1!important}</style>\n</head>";
      const bust = `dev${Date.now()}`;
      buf = Buffer.from(
        buf
          .toString("utf8")
          .replace(/\sloading="lazy"/g, "")
          .replace(/(\?v=)[a-f0-9]+/g, `$1${bust}`)
          .replace("</head>", inject)
          .replace("</body>", shotScript || "</body>"),
        "utf8",
      );
    }
    await writeFile(out, buf);
  }
}

await mkdir(to, { recursive: true });
await copy(from, from);
console.log("preview ready:", to);
