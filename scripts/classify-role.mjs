#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyFactoryRole } from "./factory-role-classifier.mjs";
import { parseCliArgs, printHelp, reportCliError } from "./factory-cli.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage:
  node scripts/classify-role.mjs --task-file <file>
    [--config <file>] [--receipt-directory <directory>]
    [--classification-mode <shadow|enforce>]
    [--classification-router <rules|factory_bert>]
    [--classification-timeout-seconds <seconds>]

Options:
  --task-file <file>          Read one bounded classification task JSON object.
  --config <file>             Use an alternate Factory configuration.
  --receipt-directory <dir>   Write classification.json to this directory.
  --classification-mode <mode>  Override the configured mode.
  --classification-router <id>  Override the configured router.
  --classification-timeout-seconds <seconds>  Override the classifier timeout.
  -h, --help                  Show this help.`;

export function parseArgs(argv) {
  return parseCliArgs(argv, {
    valueFlags: {
      "--task-file": "taskFile",
      "--config": "config",
      "--receipt-directory": "receiptDirectory",
      "--classification-mode": "classificationMode",
      "--classification-router": "classificationRouter",
      "--classification-timeout-seconds": "classificationTimeoutSeconds",
    },
  });
}

export async function classifyFromFiles({
  taskFile,
  configFile = path.join(ROOT, "factory.config.json"),
  receiptDirectory,
  overrides = {},
}) {
  const factoryConfig = JSON.parse(readFileSync(path.resolve(configFile), "utf8"));
  if (!factoryConfig.classification) throw new Error("Factory configuration does not define classification");
  const classification = { ...factoryConfig.classification, ...overrides };
  const task = JSON.parse(readFileSync(path.resolve(taskFile), "utf8"));
  const resolvedReceiptDirectory = receiptDirectory ? path.resolve(receiptDirectory) : undefined;
  if (resolvedReceiptDirectory && existsSync(path.join(resolvedReceiptDirectory, "classification.json"))) {
    throw new Error("Receipt directory already contains classification.json; choose a new --receipt-directory");
  }
  return classifyFactoryRole({
    task,
    classification,
    receiptDirectory: resolvedReceiptDirectory,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp(USAGE);
    return null;
  }
  if (!options.taskFile) throw new Error("Missing --task-file");
  const result = await classifyFromFiles({
    taskFile: options.taskFile,
    configFile: options.config,
    receiptDirectory: options.receiptDirectory,
    overrides: {
      ...(options.classificationMode ? { mode: options.classificationMode } : {}),
      ...(options.classificationRouter ? { router: options.classificationRouter } : {}),
      ...(options.classificationTimeoutSeconds
        ? { timeoutSeconds: Number(options.classificationTimeoutSeconds) }
        : {}),
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(reportCliError);
}
