export function parseCliArgs(argv, {
  valueFlags = {},
  booleanFlags = {},
  defaults = {},
} = {}) {
  const options = { ...defaults };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const rawToken = argv[index];
    const token = rawToken === "-h" ? "--help" : rawToken;
    if (!token.startsWith("-")) throw new Error(`Unexpected positional argument: ${rawToken}`);
    const key = valueFlags[token] ?? booleanFlags[token] ?? (token === "--help" ? "help" : null);
    if (!key) throw new Error(`Unknown option: ${rawToken}`);
    if (seen.has(token)) throw new Error(`Duplicate option: ${token}`);
    seen.add(token);
    if (token in valueFlags) {
      const value = argv[index + 1];
      if (!value || value === "-h" || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      options[key] = value;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

export function printHelp(usage) {
  process.stdout.write(`${usage.trimEnd()}\n`);
}

export function reportCliError(error) {
  process.stderr.write(`Error: ${error.message}\nRun with --help for usage.\n`);
  process.exitCode = 1;
}
