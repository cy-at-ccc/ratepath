import { spawnSync } from "node:child_process";

function resolveBuildId() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8"
  });

  if (result.status === 0) {
    return result.stdout.trim() || "dev";
  }

  return "dev";
}

const result = spawnSync("next", ["build"], {
  env: {
    ...process.env,
    NEXT_PUBLIC_BUILD_ID: resolveBuildId()
  },
  shell: process.platform === "win32",
  stdio: "inherit"
});

process.exit(result.status ?? 1);
