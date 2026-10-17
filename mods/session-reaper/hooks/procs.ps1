# Without arguments: prints every process as JSON {pid, ppid, name, created, cpu}.
# created = creation time as UTC FILETIME, cpu = kernel+user time in 100 ns units.
# -Self: prints {pid, created, app} of the nearest claude.exe above this script (the session's own process);
#   app = {pid, created} of its parent when that is an older claude.exe (the desktop app instance), else null.
# -Kill "pid:created,...": stops each process only while its creation time still matches (no PID reuse hits).
param([string]$Kill, [switch]$Self)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$props = 'ProcessId', 'ParentProcessId', 'Name', 'CreationDate', 'KernelModeTime', 'UserModeTime'
if ($Self) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -Property $props
  for ($hops = 0; $p -and $hops -lt 64; $hops++) {
    if ($p.Name -ieq 'claude.exe') {
      $a = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$p.ParentProcessId)" -Property $props
      # Assigned in the branch: an if without a match yields AutomationNull, which ConvertTo-Json prints as {}.
      $app = $null
      if ($a -and $a.Name -ieq 'claude.exe' -and $a.CreationDate -le $p.CreationDate) {
        $app = [ordered]@{ pid = [int]$a.ProcessId; created = [string]$a.CreationDate.ToFileTimeUtc() } }
      [Console]::Out.Write((ConvertTo-Json -InputObject ([ordered]@{ pid = [int]$p.ProcessId; created = [string]$p.CreationDate.ToFileTimeUtc(); app = $app }) -Compress))
      return
    }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$p.ParentProcessId)" -Property $props
  }
  [Console]::Error.Write('no claude.exe above this process')
  exit 1
}
if (-not $Kill) {
  $rows = foreach ($p in Get-CimInstance Win32_Process -Property $props) {
    if (-not $p.CreationDate) { continue }
    [ordered]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = $p.Name
      created = [string]$p.CreationDate.ToFileTimeUtc(); cpu = [double]($p.KernelModeTime + $p.UserModeTime) }
  }
  [Console]::Out.Write((ConvertTo-Json -InputObject @($rows) -Compress))
  return
}
$out = foreach ($item in $Kill -split ',') {
  $id, $created = $item -split ':'
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$id)" -Property $props
  $result = if (-not $p) { 'gone' }
    elseif ([string]$p.CreationDate.ToFileTimeUtc() -ne $created) { 'reused' }
    else { try { Stop-Process -Id ([int]$id) -Force; 'killed' } catch { 'error: ' + $_.Exception.Message } }
  [ordered]@{ pid = [int]$id; created = $created; result = $result }
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($out) -Compress))
