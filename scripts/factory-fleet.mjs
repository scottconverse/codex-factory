import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export const QUALIFICATION_HARNESSES = Object.freeze({
  analysis: "analysis-exact-artifact-v1",
  benchmark: "structured-reasoning-v1",
  structured_write: "structured-file-worktree-v1",
  workspace_write: "workspace-write-worktree-v1",
});

const TIER_RANK = Object.freeze({ economy: 1, standard: 2, premium: 3 });

function candidateId(provider, model) {
  return `${provider}:${model}`;
}

function inferLocalTier(model) {
  const billions = Number(model.match(/(?:^|[:_-])(\d+(?:\.\d+)?)b(?:$|[:_-])/i)?.[1]);
  if (!Number.isFinite(billions)) return "economy";
  if (billions <= 10) return "economy";
  if (billions <= 30) return "standard";
  return "premium";
}

function normalizeOpenAiCandidate(value) {
  if (!value || typeof value.model !== "string" || !value.model.trim()) {
    throw new Error("Configured Codex candidate requires a model");
  }
  if (!(value.tier in TIER_RANK)) throw new Error(`Unsupported candidate tier: ${value.tier}`);
  if (!["low", "medium", "high", "xhigh"].includes(value.reasoningEffort)) {
    throw new Error(`Unsupported reasoning effort for ${value.model}`);
  }
  return {
    id: candidateId("openai", value.model),
    provider: "openai",
    model: value.model,
    runtimeVersion: value.runtimeVersion ?? detectCodexRuntimeVersion(),
    adapterVersion: "codex-exec-v1",
    tier: value.tier,
    reasoningEffort: value.reasoningEffort,
    paid: true,
    tokenReservation: value.tokenReservation ?? null,
  };
}

let detectedCodexRuntimeVersion;
export function codexLauncher(env = process.env) {
  if (Object.hasOwn(env, "CODEX_FACTORY_CODEX_SHIM")) {
    const configured = env.CODEX_FACTORY_CODEX_SHIM;
    if (typeof configured !== "string" || !configured.trim()) {
      throw new Error("CODEX_FACTORY_CODEX_SHIM must be a nonempty file path");
    }
    const shim = path.resolve(configured);
    if (!existsSync(shim) || !statSync(shim).isFile()) {
      throw new Error(`CODEX_FACTORY_CODEX_SHIM is not a file: ${shim}`);
    }
    return { command: process.execPath, argsPrefix: [shim] };
  }
  if (Object.hasOwn(env, "CODEX_FACTORY_CODEX_COMMAND")) {
    const override = env.CODEX_FACTORY_CODEX_COMMAND;
    if (typeof override !== "string" || !override.trim()) {
      throw new Error("CODEX_FACTORY_CODEX_COMMAND must be a nonempty executable path");
    }
    return { command: override, argsPrefix: [] };
  }
  return { command: process.platform === "win32" ? "codex.exe" : "codex", argsPrefix: [] };
}

export function detectCodexRuntimeVersion() {
  if (detectedCodexRuntimeVersion) return detectedCodexRuntimeVersion;
  const { command, argsPrefix } = codexLauncher();
  const result = spawnSync(command, [...argsPrefix, "--version"], { encoding: "utf8", windowsHide: true });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  detectedCodexRuntimeVersion = result.status === 0 && text ? text : "codex-cli-unavailable";
  return detectedCodexRuntimeVersion;
}

export function parseOllamaDiscovery(versionPayload, tagsPayload) {
  const runtimeVersion = typeof versionPayload?.version === "string" && versionPayload.version.trim()
    ? versionPayload.version
    : "unknown";
  const models = (Array.isArray(tagsPayload?.models) ? tagsPayload.models : [])
    .filter((item) => typeof item?.name === "string" && item.name.trim())
    .map((item) => ({
      name: item.name,
      ...(typeof item.digest === "string" && item.digest.trim() ? { digest: item.digest } : {}),
      capabilities: Array.isArray(item.capabilities)
        ? item.capabilities.filter((capability) => typeof capability === "string")
        : [],
    }));
  return { runtimeVersion, models };
}

export function ollamaBaseUrl(env = process.env) {
  const configured = (env.CODEX_FACTORY_TEST_OLLAMA_URL ?? "http://127.0.0.1:11434").trim();
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("CODEX_FACTORY_TEST_OLLAMA_URL must be a valid HTTP URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("CODEX_FACTORY_TEST_OLLAMA_URL must be a valid HTTP URL without credentials, query, or fragment");
  }
  return configured.replace(/\/+$/, "");
}

export async function discoverOllama(baseUrl = ollamaBaseUrl(), fetchImpl = fetch) {
  const normalized = baseUrl.replace(/\/+$/, "");
  const [versionResponse, tagsResponse] = await Promise.all([
    fetchImpl(`${normalized}/api/version`),
    fetchImpl(`${normalized}/api/tags`),
  ]);
  if (!versionResponse.ok || !tagsResponse.ok) {
    throw new Error(`Ollama discovery failed (${versionResponse.status}/${tagsResponse.status})`);
  }
  const versionPayload = await versionResponse.json();
  const tagsPayload = await tagsResponse.json();
  const enrichedModels = await Promise.all((Array.isArray(tagsPayload?.models) ? tagsPayload.models : []).map(async (item) => {
    if (typeof item?.name !== "string" || !item.name.trim()) return item;
    try {
      const showResponse = await fetchImpl(`${normalized}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: item.name }),
      });
      if (!showResponse.ok) return item;
      const details = await showResponse.json();
      return { ...item, capabilities: details.capabilities };
    } catch {
      return item;
    }
  }));
  return parseOllamaDiscovery(versionPayload, { models: enrichedModels });
}

export function discoverCandidatePool({ config, ollama }) {
  const localModels = Array.isArray(ollama?.models) ? ollama.models : [];
  const local = localModels.map((value) => {
    const model = typeof value === "string" ? value : value?.name;
    if (typeof model !== "string" || !model.trim()) throw new Error("Ollama discovery returned a model without a name");
    return {
      id: candidateId("ollama", model),
      provider: "ollama",
      model,
      runtimeVersion: ollama.runtimeVersion ?? "unknown",
      adapterVersion: "ollama-direct-v1",
      tier: inferLocalTier(model),
      reasoningEffort: "low",
      paid: false,
      tokenReservation: null,
      capabilities: typeof value === "string" ? [] : value.capabilities ?? [],
      ...(typeof value === "object" && typeof value.digest === "string" && value.digest.trim()
        ? { digest: value.digest }
        : {}),
    };
  });
  const openai = (config?.candidates?.openai ?? []).map(normalizeOpenAiCandidate);
  return [...local, ...openai];
}

export function candidateFingerprint(candidate, role) {
  const harness = QUALIFICATION_HARNESSES[role];
  if (!harness) throw new Error(`Unknown qualification role: ${role}`);
  return createHash("sha256").update(JSON.stringify({
    candidateId: candidate.id,
    runtimeVersion: candidate.runtimeVersion,
    adapterVersion: candidate.adapterVersion,
    capabilities: candidate.capabilities ?? [],
    digest: candidate.digest ?? null,
    tier: candidate.tier,
    reasoningEffort: candidate.reasoningEffort,
    harness,
  })).digest("hex");
}

export function qualificationPlan(candidates) {
  return candidates.flatMap((candidate) => {
    if (candidate.provider === "ollama"
      && candidate.capabilities.includes("embedding")
      && !candidate.capabilities.includes("completion")) return [];
    const roles = candidate.provider === "ollama"
      ? ["analysis", "benchmark", "structured_write"]
      : ["analysis", "benchmark", "workspace_write"];
    return roles.map((role) => ({
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      role,
      harness: QUALIFICATION_HARNESSES[role],
      fingerprint: candidateFingerprint(candidate, role),
      ...(candidate.digest ? { digest: candidate.digest } : {}),
    }));
  });
}

function currentQualification(candidate, qualifications, role) {
  const fingerprint = candidateFingerprint(candidate, role);
  const matching = qualifications.filter((item) =>
    item.candidateId === candidate.id
    && item.role === role
    && item.fingerprint === fingerprint);
  const latest = matching.reduce((selected, item) => {
    if (!selected) return item;
    return String(item.finishedAt ?? "") >= String(selected.finishedAt ?? "") ? item : selected;
  }, null);
  return latest?.passed === true ? latest : null;
}

function tierFit(candidateTier, requiredTier) {
  const difference = TIER_RANK[candidateTier] - TIER_RANK[requiredTier];
  return difference < 0 ? null : difference;
}

export function selectCandidate({
  candidates,
  qualifications,
  role,
  requiredTier = "economy",
  excludedCandidateIds = [],
}) {
  if (!(requiredTier in TIER_RANK)) throw new Error(`Unsupported required tier: ${requiredTier}`);
  const excluded = new Set(excludedCandidateIds);
  const eligible = candidates.flatMap((candidate, discoveryIndex) => {
    if (excluded.has(candidate.id)) return [];
    const fit = tierFit(candidate.tier, requiredTier);
    if (fit === null || !currentQualification(candidate, qualifications, role)) return [];
    if (["structured_write", "workspace_write"].includes(role)
      && !currentQualification(candidate, qualifications, "benchmark")) return [];
    return [{
      ...candidate,
      qualificationRole: role,
      qualificationFingerprint: candidateFingerprint(candidate, role),
      score: (candidate.paid ? 0 : 1_000) - fit * 10,
      discoveryIndex,
    }];
  }).sort((left, right) =>
    right.score - left.score
    || left.discoveryIndex - right.discoveryIndex
    || left.id.localeCompare(right.id));
  if (!eligible.length) throw new Error(`No currently qualified candidate can perform ${role} at ${requiredTier} tier`);
  const selected = eligible[0];
  return {
    ...selected,
    factors: [
      "exact current role qualification passed",
      `${selected.tier} tier satisfies ${requiredTier}`,
      selected.paid ? "metered candidate selected after free candidates were ineligible" : "free local candidate preferred",
    ],
  };
}
