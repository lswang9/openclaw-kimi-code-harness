import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const COMMIT = "f082f04a093a3e71a2263c5461d52507dc31f83a";
const REPOSITORY = "https://github.com/MoonshotAI/kimi-code.git";
const root = resolve(import.meta.dirname, "..");
const source = process.env.KIMI_CODE_SOURCE_DIR
  ? resolve(process.env.KIMI_CODE_SOURCE_DIR)
  : resolve(root, ".kimi-code-source");

run("git", ["--version"]);
if (!existsSync(resolve(source, ".git"))) {
  await rm(source, { recursive: true, force: true });
  run("git", ["clone", "--no-checkout", REPOSITORY, source]);
}
run("git", ["-C", source, "fetch", "--depth", "1", "origin", COMMIT]);
run("git", ["-C", source, "checkout", "--detach", COMMIT]);
const revision = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
if (revision.status !== 0 || revision.error) {
  throw revision.error ?? new Error("git rev-parse failed");
}
const actualCommit = revision.stdout.trim();
if (actualCommit !== COMMIT) {
  throw new Error(`Expected Kimi Code ${COMMIT}, got ${actualCommit}`);
}
run("pnpm", ["install", "--frozen-lockfile"], source);
run("pnpm", ["--filter", "@moonshot-ai/kimi-code-sdk", "build"], source);
await mkdir(resolve(root, "vendor"), { recursive: true });
await build({
  entryPoints: [resolve(source, "packages/node-sdk/dist/index.mjs")],
  outfile: resolve(root, "vendor/kimi-code-sdk.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  minify: false,
  logLevel: "warning",
  banner: {
    js: "import { createRequire as __kimiCreateRequire } from 'node:module'; const require = __kimiCreateRequire(import.meta.url);",
  },
});
await copyFile(resolve(source, "LICENSE"), resolve(root, "vendor/KIMI_CODE_LICENSE"));
await writeFile(
  resolve(root, "vendor/PROVENANCE.json"),
  `${JSON.stringify({ repository: REPOSITORY, commit: COMMIT, package: "@moonshot-ai/kimi-code-sdk", sourcePath: "packages/node-sdk", entryPoint: "dist/index.mjs" }, null, 2)}\n`,
);
const notice = await readFile(resolve(source, "README.md"), "utf8");
if (!notice.includes("Kimi Code")) {
  throw new Error("Official Kimi Code source checkout failed its identity check");
}
console.log(`Bundled official Kimi Code SDK at ${COMMIT}`);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return result.stdout ?? "";
}
