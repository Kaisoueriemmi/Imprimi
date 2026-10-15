#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stops and removes the PrintBox agent service. With -RemoveFiles, also deletes the install
  folder (configuration, local state and logs).
#>
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'PrintBox'),
  [string]$ServiceName = 'PrintBoxAgent',
  [switch]$RemoveFiles
)

$ErrorActionPreference = 'Stop'
$serviceExe = Join-Path $InstallDir "$ServiceName.exe"

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
  if (Test-Path $serviceExe) {
    & $serviceExe uninstall
  } else {
    & sc.exe delete $ServiceName | Out-Null
  }
  Write-Host "Service $ServiceName removed."
} else {
  Write-Host "Service $ServiceName is not installed."
}

if ($RemoveFiles -and (Test-Path $InstallDir)) {
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "$InstallDir deleted."
}
