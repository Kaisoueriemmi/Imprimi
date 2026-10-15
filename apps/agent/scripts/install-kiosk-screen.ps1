<#
.SYNOPSIS
  Opens the PrintBox kiosk screen in Chrome kiosk mode at every Windows logon.

.DESCRIPTION
  Creates a shortcut in the Startup folder of the current user (the account that logs on
  automatically on the kiosk PC). Chrome runs full screen, without address bar, error dialogs,
  "restore pages" bubble, pinch zoom or swipe navigation, in a dedicated profile so the kiosk
  display key is remembered.

  Run it as the kiosk user (not as administrator). The display key (pbd_...) is printed once
  when the kiosk is created; it goes in the URL fragment (#key=...), never sent to the server.

.EXAMPLE
  .\install-kiosk-screen.ps1 -WebUrl https://print.example.tn -KioskId demo-kiosk -DisplayKey pbd_xxx
#>
param(
  [Parameter(Mandatory = $true)][string]$WebUrl,
  [Parameter(Mandatory = $true)][string]$KioskId,
  [Parameter(Mandatory = $true)][string]$DisplayKey,
  [string]$ChromePath
)

$ErrorActionPreference = 'Stop'

if (-not $DisplayKey.StartsWith('pbd_')) { throw 'DisplayKey must be the kiosk display key (pbd_...), not the agent key.' }

if (-not $ChromePath) {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google/Chrome/Application/chrome.exe')
  )
  $ChromePath = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $ChromePath) { throw 'Google Chrome not found: install it or pass -ChromePath.' }
}

$profileDir = Join-Path $env:LOCALAPPDATA 'PrintBox/kiosk-chrome-profile'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$url = '{0}/kiosk/{1}#key={2}' -f $WebUrl.TrimEnd('/'), [uri]::EscapeDataString($KioskId), $DisplayKey
$arguments = @(
  '--kiosk',
  "`"$url`"",
  "--user-data-dir=`"$profileDir`"",
  '--no-first-run',
  '--noerrdialogs',
  '--disable-session-crashed-bubble',
  '--disable-infobars',
  '--disable-translate',
  '--disable-pinch',
  '--overscroll-history-navigation=0',
  '--autoplay-policy=no-user-gesture-required',
  '--check-for-update-interval=31536000'
) -join ' '

$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'PrintBox kiosk screen.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $ChromePath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = Split-Path $ChromePath
$shortcut.Description = 'PrintBox kiosk screen (Chrome kiosk mode)'
$shortcut.Save()

Write-Host "Shortcut created: $shortcutPath"
Write-Host 'The kiosk screen opens at the next logon. To open it now, run the shortcut.'
Write-Host 'Leave kiosk mode with Alt+F4.'
