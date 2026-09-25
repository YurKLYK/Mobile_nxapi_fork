param(
    [string]$NpmCommand = 'npm.cmd'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$project = Join-Path $PSScriptRoot 'app\nodejs-project'
$assets = Join-Path $PSScriptRoot 'app\src\main\assets'

if (Test-Path -LiteralPath $project) {
    $resolvedProject = (Resolve-Path -LiteralPath $project).Path
    $expectedProject = [System.IO.Path]::GetFullPath($project)
    if ($resolvedProject -ne $expectedProject -or -not $resolvedProject.StartsWith([System.IO.Path]::GetFullPath($PSScriptRoot))) {
        throw "Refusing to remove unexpected staging directory: $resolvedProject"
    }
    Remove-Item -LiteralPath $resolvedProject -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $project, $assets | Out-Null
Copy-Item (Join-Path $root 'dist') $project -Recurse -Force
Copy-Item (Join-Path $root 'mobile') $project -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $project 'resources\common') | Out-Null
Copy-Item (Join-Path $root 'resources\common\*') (Join-Path $project 'resources\common') -Force
Copy-Item (Join-Path $root 'package.json') $project -Force
Copy-Item (Join-Path $root 'package-lock.json') $project -Force

Push-Location $project
try {
    $npm = Get-Command $NpmCommand -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw "npm was not found. Install Node.js/npm or pass -NpmCommand with the full path to npm.cmd."
    }
    & $npm.Source ci --omit=dev --ignore-scripts
} finally {
    Pop-Location
}

$archive = Join-Path $assets 'node-project.zip'
Compress-Archive -Path (Join-Path $project '*') -DestinationPath $archive -CompressionLevel Optimal -Force
Write-Host "Created $archive"
