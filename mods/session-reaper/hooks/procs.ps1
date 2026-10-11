# Without -Kill: prints every process as JSON {pid, ppid, name, created, cpu}.
# created = creation time as UTC FILETIME, cpu = kernel+user time in 100 ns units.
# -Kill "pid:created,...": stops each process only while its creation time still matches (no PID reuse hits).
param([string]$Kill)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$props = 'ProcessId', 'ParentProcessId', 'Name', 'CreationDate', 'KernelModeTime', 'UserModeTime'
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
