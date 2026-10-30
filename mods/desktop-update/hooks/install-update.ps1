# Downloads a Claude Desktop MSIX named by Anthropic's update feed, checks its SHA256,
# installs it over the running package and starts Desktop again.
# Exit codes: 0 done (or detached copy started), 1 failed, 2 refused (URL, hash).
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Url,
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$Sha256,
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [string]$Relaunch = 'explorer.exe shell:AppsFolder\Claude_pzs8sxrjxfjjc!Claude',
  [string]$RelaunchB64 = '',
  [switch]$Detach,
  [switch]$NoInstall
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# No quotes or spaces: -Detach splices the URL into a command line
if ($Url -notmatch '^https://downloads\.claude\.ai/[^"\s]+\z') { [Console]::Error.WriteLine("Refused download URL: $Url"); exit 2 }
if ($RelaunchB64) { $Relaunch = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RelaunchB64)) }

if ($Detach) {
  # Win32_Process.Create starts the copy under the WMI service, outside the calling session's
  # process tree, so closing Desktop (and its Claude Code sessions) does not stop it
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Relaunch))
  $cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Url `"$Url`" -Sha256 $Sha256 -Version $Version -RelaunchB64 $b64"
  if ($NoInstall) { $cmd += ' -NoInstall' }
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; ProcessStartupInformation = $startup }
  if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine("Win32_Process.Create returned $($r.ReturnValue)"); exit 1 }
  Write-Output $r.ProcessId
  exit 0
}

$dir = Join-Path $env:LOCALAPPDATA 'claude-desktop-update'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'install.log'
function Write-Log([string]$Message) { Add-Content -Path $log -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message) -Encoding UTF8 }
# The relaunch option is synced with the settings and can name another PC's launcher; this file is per PC
$localRelaunch = Join-Path $dir 'relaunch.cmd'
if (Test-Path -LiteralPath $localRelaunch) { $Relaunch = "`"$localRelaunch`"" }

# Two sessions can press install at the same time; only one runs
$mutex = New-Object Threading.Mutex($false, 'Local\claude-desktop-update')
if (-not $mutex.WaitOne(0)) { Write-Log "skip $Version`: another install is running"; exit 0 }

$msix = Join-Path $dir "Claude-$Version.msix"
$hash = $null
try {
  Write-Log "start $Version from $Url, relaunch: $Relaunch"
  Invoke-WebRequest -Uri $Url -OutFile $msix -UseBasicParsing
  $hash = (Get-FileHash -Path $msix -Algorithm SHA256).Hash
  if ($hash -ne $Sha256) {
    Write-Log "refused $Version`: SHA256 $hash does not match the feed's $Sha256"
    exit 2
  }
  Write-Log "SHA256 ok"
  if ($NoInstall) { Write-Log 'NoInstall: stop after the check'; exit 0 }
} catch {
  Write-Log "failed $Version`: $($_.Exception.Message)"
  exit 1
} finally {
  # Keep the file only when it is verified and about to be installed
  if ($NoInstall -or $hash -ne $Sha256) { Remove-Item -LiteralPath $msix -Force -ErrorAction SilentlyContinue }
}

# From here Desktop may be closed, so it is started again whatever the install did
$code = 0
try {
  Add-AppxPackage -Path $msix -ForceApplicationShutdown
  Write-Log "installed $Version"
} catch {
  Write-Log "install of $Version failed: $($_.Exception.Message)"
  $code = 1
}
Remove-Item -LiteralPath $msix -Force -ErrorAction SilentlyContinue
try {
  Start-Process -FilePath cmd.exe -ArgumentList '/d', '/c', $Relaunch -WindowStyle Hidden
  Write-Log "relaunch: $Relaunch"
} catch {
  Write-Log "relaunch failed: $($_.Exception.Message)"
  $code = 1
}
exit $code
