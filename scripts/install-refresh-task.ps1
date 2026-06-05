param(
    [string]$TaskName = "RateMonitoringRefresh",
    [int]$IntervalMinutes = 15,
    [string]$EnvFile = ".env.local"
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1) {
    throw "IntervalMinutes must be at least 1."
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$pipelineScript = Join-Path $repoRoot "scripts\refresh-and-publish.py"
$python = (Get-Command python -ErrorAction Stop).Source

# Prefer pythonw.exe so the scheduled run executes with no visible console window.
$pythonw = Join-Path (Split-Path $python -Parent) "pythonw.exe"
$exe = if (Test-Path -LiteralPath $pythonw) { $pythonw } else { $python }

if (-not (Test-Path -LiteralPath $pipelineScript)) {
    throw "Missing pipeline script: $pipelineScript"
}

# Pipeline = refresh Oracle cache -> publish weekly-monitoring.json to Google Drive.
$argument = "`"$pipelineScript`" --env-file `"$EnvFile`""
$action = New-ScheduledTaskAction -Execute $exe -Argument $argument -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -Hidden `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Refresh Oracle rate-monitoring cache and publish to Google Drive (headless)" `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' every $IntervalMinutes minutes (no window; logs to logs\refresh-and-publish.log)."
Write-Host "Run once now: Start-ScheduledTask -TaskName '$TaskName'"
