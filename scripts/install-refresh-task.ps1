param(
    [string]$TaskName = "RateMonitoringRefresh",
    [string[]]$DailyTimes = @("06:30", "12:00"),
    [string]$EnvFile = ".env.local"
)

$ErrorActionPreference = "Stop"

if (-not $DailyTimes -or $DailyTimes.Count -eq 0) {
    throw "DailyTimes must include at least one HH:mm value."
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
$trigger = foreach ($dailyTime in $DailyTimes) {
    $parsedTime = [datetime]::ParseExact(
        $dailyTime,
        [string[]]@("HH:mm", "H:mm"),
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::None
    )
    New-ScheduledTaskTrigger -Daily -At $parsedTime
}
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

Write-Host "Registered scheduled task '$TaskName' daily at $($DailyTimes -join ', ') (no window; logs to logs\refresh-and-publish.log)."
Write-Host "Run once now: Start-ScheduledTask -TaskName '$TaskName'"
