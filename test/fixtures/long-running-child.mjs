import { writeFileSync } from "node:fs";

process.stdin.resume();
setInterval(() => {}, 1_000);
setTimeout(() => {
  if (process.argv[2]) writeFileSync(process.argv[2], "natural exit\n");
  process.exit(0);
}, 750);
