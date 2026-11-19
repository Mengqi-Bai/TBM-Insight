[CmdletBinding()]
param(
    [string] $NodePath,
    [string] $PnpmPath,
    [string] $PythonPath,
    [switch] $NoOpen,
    [ValidateRange(0, 65535)] [int] $Port = 0
)

$ErrorActionPreference = 'Stop'
$minimumNode = [version] '24.9.0'

$bundledNode = Join-Path $PSScriptRoot '.runtime/node/node.exe'
$bundledPython = Join-Path $PSScriptRoot '.runtime/python/python.exe'

if ($NodePath) {
    $nodeCandidates = @(Get-Command -Name $NodePath -CommandType Application)
} else {
    $nodeCandidates = @()
    if (Test-Path -LiteralPath $bundledNode) {
        $nodeCandidates += @(Get-Command -Name $bundledNode -CommandType Application -ErrorAction SilentlyContinue)
    }
    $nodeCandidates += @(Get-Command -Name node -All -CommandType Application -ErrorAction SilentlyContinue)
}
$compatibleNode = $nodeCandidates | Where-Object { $_ -and $_.Version -ge $minimumNode } | Select-Object -First 1
if (!$compatibleNode) {
    throw 'TBM Insight requires Node.js 24.9 or newer. Add it to PATH or pass -NodePath.'
}

$pnpmEntry = if ($PnpmPath) { (Get-Command -Name $PnpmPath -CommandType Application).Source }

$originalPath = $env:Path
$originalPython = $env:TBM_INSIGHT_PYTHON
$originalTbmHome = $env:TBM_ENGINE_HOME
$originalProductHome = $env:TBM_INSIGHT_HOME
$originalResearchProjects = $env:TBM_INSIGHT_RESEARCH_PROJECTS
$originalTelemetry = $env:TBM_ENGINE_TELEMETRY_DISABLED
$repoRoot = Split-Path -Parent $PSScriptRoot
$overlay = Join-Path $PSScriptRoot 'application.yml'
$releaseEntry = Join-Path $repoRoot 'lib/bin.js'
$portable = (Test-Path -LiteralPath $releaseEntry -PathType Leaf)
$productHome = if ($env:TBM_INSIGHT_HOME) { $env:TBM_INSIGHT_HOME } elseif ($portable) {
    Join-Path $env:LOCALAPPDATA 'TBM Insight'
} else { Join-Path $PSScriptRoot '.local' }
$webOptions = @('--port', [string] $Port)
if ($NoOpen) { $webOptions += '--no-open' }

Push-Location -LiteralPath $repoRoot
try {
    $env:Path = (Split-Path -Parent $compatibleNode.Source) + [IO.Path]::PathSeparator + $originalPath
    $env:TBM_INSIGHT_HOME = $productHome
    $env:TBM_ENGINE_HOME = $productHome
    $env:TBM_ENGINE_TELEMETRY_DISABLED = '1'
    if ($portable -and !$env:TBM_INSIGHT_RESEARCH_PROJECTS) {
        $env:TBM_INSIGHT_RESEARCH_PROJECTS = Join-Path $productHome 'research'
    }
    if ($PythonPath) {
        $env:TBM_INSIGHT_PYTHON = (Get-Command -Name $PythonPath -CommandType Application).Source
    } elseif (!$originalPython -and (Test-Path -LiteralPath $bundledPython -PathType Leaf)) {
        $env:TBM_INSIGHT_PYTHON = $bundledPython
    }
    Write-Host 'Starting TBM Insight'
    & $compatibleNode.Source (Join-Path $PSScriptRoot 'release/migrate-profile.mjs') $productHome
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($portable) {
        & $compatibleNode.Source (Join-Path $PSScriptRoot 'release/prepare-links.mjs') $repoRoot
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & $compatibleNode.Source --disable-warning ExperimentalWarning --experimental-transform-types $releaseEntry web --patch $overlay @webOptions
    } elseif (!$pnpmEntry) {
        & $compatibleNode.Source --import tsx/esm apps/cli/src/bin.ts web --patch $overlay @webOptions
    } elseif ($pnpmEntry -match '\.(cjs|mjs|js)$') {
        & node $pnpmEntry tbm web --patch $overlay @webOptions
    } else {
        & $pnpmEntry tbm web --patch $overlay @webOptions
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
    $env:Path = $originalPath
    $env:TBM_INSIGHT_PYTHON = $originalPython
    $env:TBM_ENGINE_HOME = $originalTbmHome
    $env:TBM_INSIGHT_HOME = $originalProductHome
    $env:TBM_INSIGHT_RESEARCH_PROJECTS = $originalResearchProjects
    $env:TBM_ENGINE_TELEMETRY_DISABLED = $originalTelemetry
}
