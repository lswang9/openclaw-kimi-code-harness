import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export async function resolveWorkspaceDir(input: {
  workspaceDir?: string;
  cwd?: string;
}): Promise<string> {
  const candidate = input.cwd?.trim() || input.workspaceDir?.trim();
  if (!candidate) {
    throw new Error("Kimi Code requires OpenClaw's prepared workspaceDir or cwd");
  }
  if (!isAbsolute(candidate)) {
    throw new Error(`Kimi Code workspace must be absolute; received "${candidate}"`);
  }
  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch (error) {
    throw new Error(`Kimi Code workspace does not exist: ${candidate}`, { cause: error });
  }
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) {
    throw new Error(`Kimi Code workspace is not a directory: ${canonical}`);
  }
  return canonical;
}
