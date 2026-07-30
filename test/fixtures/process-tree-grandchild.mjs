import { appendFileSync } from "node:fs";
import process from "node:process";

appendFileSync(process.argv[2], `${JSON.stringify({ role: "grandchild", pid: process.pid })}\n`);
setInterval(() => {}, 1_000);
