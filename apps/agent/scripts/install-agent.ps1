#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs (or upgrades) the PrintBox agent as a Windows service that starts with Windows and
  restarts automatically if it stops.

.DESCRIPTION
  - copies printbox-agent.exe and agent.config.json to the install folder;
  - downloads WinSW (service wrapper), checking its SHA-256;
  - registers the "PrintBoxAgent" service: automatic start, restart on failure, rotated logs
    in <install folder>/logs;
  - restricts the folder to SYSTEM and Administrators (the config holds the kiosk API key).

  The service runs as LocalSystem: the printer must be installed for all users (a local USB or
  network printer added by an administrator). To use another account, change it afterwards in
  services.msc > PrintBoxAgent > Log On.

.EXAMPLE
  .\install-agent.ps1
  .\install-agent.ps1 -ConfigFile D:\kiosk\agent.config.json
#>
param(
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'PrintBox'),
  [string]$ConfigFile = (Join-Path $PSScriptRoot 'agent.config.json'),
  [string]$AgentExe = (Join-Path $PSScriptRoot 'printbox-agent.exe'),
  [string]$ServiceName = 'PrintBoxAgent'
)

$ErrorActionPreference = 'Stop'

# WinSW 2.12.0 (x64), pinned and verified.
$WinSwUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$WinSwSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'

if (-not (Test-Path $AgentExe)) { throw "printbox-agent.exe not found: $AgentExe" }
if (-not (Test-Path $ConfigFile)) {
  throw "agent.config.json not found: $ConfigFile (copy agent.config.example.json and fill it in)"
}
# Fail early on an invalid configuration (JSON syntax and every field).
& $AgentExe check-config --config $ConfigFile
if ($LASTEXITCODE -ne 0) { throw 'Fix agent.config.json, then run this script again.' }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$serviceExe = Join-Path $InstallDir "$ServiceName.exe"
$serviceXml = Join-Path $InstallDir "$ServiceName.xml"

# Upgrade: stop the running service before replacing the executable.
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "Stopping the existing $ServiceName service..."
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(90))
  $upgrade = $true
} else {
  $upgrade = $false
}

Copy-Item -Force $AgentExe (Join-Path $InstallDir 'printbox-agent.exe')
if ((Resolve-Path $ConfigFile).Path -ne (Join-Path $InstallDir 'agent.config.json')) {
  Copy-Item -Force $ConfigFile (Join-Path $InstallDir 'agent.config.json')
}

if (-not (Test-Path $serviceExe)) {
  Write-Host 'Downloading WinSW...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $download = Join-Path $env:TEMP 'WinSW-x64.exe'
  Invoke-WebRequest -Uri $WinSwUrl -OutFile $download -UseBasicParsing
  $hash = (Get-FileHash -Algorithm SHA256 $download).Hash
  if ($hash -ne $WinSwSha256) {
    Remove-Item -Force $download
    throw "WinSW checksum mismatch ($hash): download refused."
  }
  Move-Item -Force $download $serviceExe
}

@"
<service>
  <id>$ServiceName</id>
  <name>PrintBox Agent</name>
  <description>PrintBox: prints paid jobs and drives the coin machine of this kiosk.</description>
  <executable>%BASE%/printbox-agent.exe</executable>
  <arguments>run --config "%BASE%/agent.config.json"</arguments>
  <workingdirectory>%BASE%</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="5 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>70 sec</stoptimeout>
  <logpath>%BASE%/logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@ | Set-Content -Encoding UTF8 $serviceXml

# Only SYSTEM (S-1-5-18) and Administrators (S-1-5-32-544): the config contains the API key.
# SIDs, not names, so it works on French or Arabic Windows too.
& icacls $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

if (-not $upgrade) {
  & $serviceExe install
  if ($LASTEXITCODE -ne 0) { throw "WinSW install failed ($LASTEXITCODE)" }
}
Start-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

Write-Host ''
Write-Host "PrintBox agent installed in $InstallDir and running as service $ServiceName."
Write-Host "Logs: $(Join-Path $InstallDir 'logs')"
Write-Host 'Test the printer with:'
Write-Host "  & '$(Join-Path $InstallDir 'printbox-agent.exe')' test-print --config '$(Join-Path $InstallDir 'agent.config.json')'"
