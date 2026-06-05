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
$refreshScript = Join-Path $repoRoot "scripts\refresh-dashboard-data.py"
$python = (Get-Command python -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $refreshScript)) {
    throw "Missing refresh script: $refreshScript"
}

$argument = "`"$refreshScript`" --oracle --env-file `"$EnvFile`""
$action = New-ScheduledTaskAction -Execute $python -Argument $argument -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Refresh Oracle rate-monitoring JSON cache" `
    -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' every $IntervalMinutes minutes."
Write-Host "Run once now: Start-ScheduledTask -TaskName '$TaskName'"
