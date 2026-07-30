import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function validateConfig(value) {
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const cwdIndex = args.indexOf("--cwd");
  if (cwdIndex < 0 || !args[cwdIndex + 1]) throw new Error("fixture worker requires --cwd");
  writeFileSync(path.join(args[cwdIndex + 1], "src", "result.txt"), "built by default launcher\n");
  process.stdout.write(`${JSON.stringify({
    status: "process_completed",
    exitCode: 0,
    finalMessage: "fixture worker completed",
  })}\n`);
}
