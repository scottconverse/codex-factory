[CmdletBinding()]
param(
  [string]$PythonCommand
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stateRoot = Join-Path $root ".codex-factory"
$venvRoot = Join-Path $stateRoot "router-venv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$bootstrapLockPath = Join-Path $root "requirements-router-bootstrap.lock"
$lockPath = Join-Path $root "requirements-router.lock"
$routeLlmRoot = Join-Path $root "third_party\routellm"
$factoryRouterRoot = Join-Path $root "python"
$packageManifestPath = Join-Path $stateRoot "router-packages.txt"
$env:PIP_DISABLE_PIP_VERSION_CHECK = "1"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(Mandatory = $true)]
    [string[]]$CommandArguments
  )
  & $Command @CommandArguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command exited with status $LASTEXITCODE"
  }
}

function Resolve-Python {
  if ($PythonCommand) {
    return @{ Command = $PythonCommand; Prefix = @() }
  }
  if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($version in @("-3.12", "-3.11")) {
      & py $version -c "import sys; print(sys.executable)" *> $null
      if ($LASTEXITCODE -eq 0) {
        return @{ Command = "py"; Prefix = @($version) }
      }
    }
  }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return @{ Command = "python"; Prefix = @() }
  }
  throw "Python 3.11 or 3.12 is required for the Factory router."
}

if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
  throw "Missing dependency lock: $lockPath"
}
if (-not (Test-Path -LiteralPath $bootstrapLockPath -PathType Leaf)) {
  throw "Missing bootstrap dependency lock: $bootstrapLockPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $routeLlmRoot "REVISION") -PathType Leaf)) {
  throw "Missing vendored RouteLLM revision."
}

if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  $python = Resolve-Python
  Invoke-Checked -Command $python.Command -CommandArguments @($python.Prefix + @("-c", "import sys; assert (3, 11) <= sys.version_info[:2] < (3, 13), sys.version"))
  Invoke-Checked -Command $python.Command -CommandArguments @($python.Prefix + @("-m", "venv", $venvRoot))
}

$pipStatus = 1
try {
  & $venvPython -m pip --version *> $null
  $pipStatus = $LASTEXITCODE
} catch {
  $pipStatus = 1
}
if ($pipStatus -ne 0) {
  Invoke-Checked -Command $venvPython -CommandArguments @("-m", "ensurepip", "--upgrade")
}
Invoke-Checked -Command $venvPython -CommandArguments @("-m", "pip", "install", "--require-hashes", "--only-binary=:all:", "--upgrade", "-r", $bootstrapLockPath)
Invoke-Checked -Command $venvPython -CommandArguments @("-m", "pip", "install", "--require-hashes", "-r", $lockPath)
Invoke-Checked -Command $venvPython -CommandArguments @("-m", "pip", "install", "--no-deps", "--no-build-isolation", "--editable", $routeLlmRoot, "--editable", $factoryRouterRoot)

$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:HF_DATASETS_OFFLINE = "1"
Invoke-Checked -Command $venvPython -CommandArguments @("-c", "import codex_factory_router.adapter; from routellm.routers.routers import Router; from codex_factory_router.schemas import parse_request; parse_request({'schemaVersion': 1, 'taskId': 'setup-smoke', 'encodedTask': '[FACTORY_TASK_V1]\noperation: read', 'router': 'factory_bert', 'checkpoint': '.', 'thresholdSet': 'setup-smoke', 'timeoutSeconds': 20}); print('Factory router import and schema smoke passed')")

$packages = (& $venvPython -m pip freeze --all | Sort-Object)
if ($LASTEXITCODE -ne 0) {
  throw "Unable to record installed Factory router packages"
}
$packages | Set-Content -LiteralPath $packageManifestPath -Encoding utf8

$pythonVersion = (& $venvPython -c "import platform; print(platform.python_version())").Trim()
$platform = (& $venvPython -c "import platform; print(platform.platform())").Trim()
$revision = (Get-Content -LiteralPath (Join-Path $routeLlmRoot "REVISION") -Raw).Trim()
$runtime = [ordered]@{
  schemaVersion = 1
  pythonVersion = $pythonVersion
  platform = $platform
  routeLLMRevision = $revision
  bootstrapLockSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $bootstrapLockPath).Hash.ToLowerInvariant()
  dependencyLockSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $lockPath).Hash.ToLowerInvariant()
  installedPackagesSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $packageManifestPath).Hash.ToLowerInvariant()
  routeLLMLicenseSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $routeLlmRoot "LICENSE")).Hash.ToLowerInvariant()
  models = @()
  recordedAt = [DateTimeOffset]::UtcNow.ToString("o")
}
$runtimePath = Join-Path $stateRoot "router-runtime.json"
$runtime | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $runtimePath -Encoding utf8
Write-Output "Factory router environment ready: $venvRoot"
Write-Output "Runtime fingerprint: $runtimePath"
