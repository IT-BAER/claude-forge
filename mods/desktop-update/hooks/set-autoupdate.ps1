# Sets the Claude Desktop policy value disableAutoUpdates (1 = Desktop's own updater off,
# 0 = on) for one user, through an elevated reg.exe (UAC).
# Writes HKU\<SID>, not HKCU: when UAC asks for another admin account, its HKCU is that admin's.
# Exit codes: 0 written (or detached copy started), 1 failed or cancelled, 2 refused (arguments).
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Sid,
  [Parameter(Mandatory)][string]$Value,
  [switch]$Detach
)
$ErrorActionPreference = 'Stop'

# Spliced into command lines below, so only a plain user SID and 0/1 pass
if ($Sid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+\z') { [Console]::Error.WriteLine("Refused SID: $Sid"); exit 2 }
if ($Value -notin '0', '1') { [Console]::Error.WriteLine("Refused value: $Value"); exit 2 }

if ($Detach) {
  # Win32_Process.Create starts the copy outside the Desktop package, so the write is not
  # redirected into the package's private registry
  $cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Sid $Sid -Value $Value"
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; ProcessStartupInformation = $startup }
  if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine("Win32_Process.Create returned $($r.ReturnValue)"); exit 1 }
  Write-Output $r.ProcessId
  exit 0
}

$dir = Join-Path $env:LOCALAPPDATA 'claude-desktop-update'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'autoupdate.log'
function Write-Log([string]$Message) { Add-Content -Path $log -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message) -Encoding UTF8 }

try {
  $p = Start-Process -FilePath "$env:SystemRoot\System32\reg.exe" -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
    'add', "HKU\$Sid\SOFTWARE\Policies\Claude", '/v', 'disableAutoUpdates', '/t', 'REG_DWORD', '/d', $Value, '/f')
  Write-Log "disableAutoUpdates=$Value for $Sid`: reg.exe exit $($p.ExitCode)"
  if ($p.ExitCode -ne 0) { exit 1 }
  exit 0
} catch {
  Write-Log "disableAutoUpdates=$Value for $Sid not written: $($_.Exception.Message)"
  exit 1
}
