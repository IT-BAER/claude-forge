# Cross-machine session handoff helper. Run with -Action, or dot-source for the functions.
# Handoffs live in ~/.claude/handoffs/<repo-slug>/ and travel with the claude-config sync.
# Must stay Windows PowerShell 5.1 compatible: the SessionStart detector dot-sources it.
param(
    [string]$Action = '',
    [string]$Cwd = '',
    [string]$Topic = '',
    [string]$File = '',
    [string]$Branch = '',
    [string]$Base = '',
    [string]$Parent = '',
    [string]$HandoffRoot = '',
    [string]$ConfigRepo = '',
    [int]$KeepDays = 14
)

function Get-HandoffRoot {
    param([string]$Override)
    if ($Override) { return $Override }
    if ($env:CLAUDE_HANDOFF_ROOT) { return $env:CLAUDE_HANDOFF_ROOT }
    return (Join-Path $HOME '.claude\handoffs')
}

function Invoke-HandoffGit {
    param([string]$Dir)
    $gitArgs = $args
    $out = & git.exe -C $Dir @gitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($out | ForEach-Object { [string]$_ }) -join "`n").Trim()
}

function Get-HandoffSlug {
    param([string]$Path)
    $top = Invoke-HandoffGit $Path rev-parse --show-toplevel
    $url = if ($top) { Invoke-HandoffGit $Path remote get-url origin } else { $null }
    if ($url) {
        $parts = @(($url.Trim() -replace '\.git$', '' -replace '[/\\]+$', '') -split '[/:\\]' | Where-Object { $_ })
        $name = if ($parts.Count -ge 2) { "$($parts[-2])-$($parts[-1])" } else { $parts[-1] }
    } else {
        $leaf = if ($top) { Split-Path -Leaf $top } else { Split-Path -Leaf $Path }
        $name = "local-$leaf"
    }
    return (($name.ToLowerInvariant() -replace '[^a-z0-9._-]+', '-').Trim('-'))
}

function Read-HandoffHeader {
    param([string]$Path)
    $line = [string](Get-Content -LiteralPath $Path -TotalCount 1 -Encoding UTF8)
    $h = @{ status = ''; time = $null; host = '' }
    if ($line -match 'handoff:\s*([^|]+?)\s*\|') {
        try { $h.time = [DateTimeOffset]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture) } catch { }
    }
    if ($line -match '\|\s*status:\s*(\w+)') { $h.status = $Matches[1] }
    if ($line -match '\|\s*host:\s*([^|]+?)\s*(\||-->)') { $h.host = $Matches[1] }
    return $h
}

# Newest handoff for the repo that contains $Path; $null when none exists.
function Find-RepoHandoff {
    param([string]$Path, [string]$Root)
    $dir = Join-Path (Get-HandoffRoot $Root) (Get-HandoffSlug $Path)
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return $null }
    $best = $null; $bestTime = $null
    foreach ($f in Get-ChildItem -LiteralPath $dir -Filter *.md -File) {
        $h = Read-HandoffHeader $f.FullName
        $t = if ($h.time) { $h.time } else { [DateTimeOffset]$f.LastWriteTime }
        if ($null -eq $best -or $t -gt $bestTime) { $best = $f; $bestTime = $t }
    }
    if ($null -eq $best) { return $null }
    return [pscustomobject]@{ Path = $best.FullName; Time = $bestTime; Header = (Read-HandoffHeader $best.FullName) }
}

function Invoke-HandoffPrepare {
    param([string]$Path, [string]$Root, [int]$Days)
    $slug = Get-HandoffSlug $Path
    $dir = Join-Path (Get-HandoffRoot $Root) $slug
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $cutoff = [DateTimeOffset]::Now.AddDays(-$Days)
    foreach ($f in Get-ChildItem -LiteralPath $dir -Filter *.md -File) {
        $h = Read-HandoffHeader $f.FullName
        if ($h.status -eq 'consumed' -and $h.time -and $h.time -lt $cutoff) {
            Remove-Item -LiteralPath $f.FullName -Force
            "pruned: $($f.Name)"
        }
    }
    $name = '{0}-{1}.md' -f (Get-Date -Format 'yyyy-MM-ddTHHmmss'), [Environment]::MachineName
    "slug: $slug"
    "path: $(Join-Path $dir $name)"
    "resume-path: ~/.claude/handoffs/$slug/$name"
}

function Get-GitBash {
    if ($env:OS -ne 'Windows_NT') { return 'bash' }
    # Plain "bash" on Windows can resolve to WSL; the sync script needs Git Bash.
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git) {
        foreach ($rel in '..\bin\bash.exe', '..\..\bin\bash.exe') {
            $p = [IO.Path]::GetFullPath((Join-Path (Split-Path $git.Source) $rel))
            if (Test-Path -LiteralPath $p) { return $p }
        }
    }
    return $null
}

function Invoke-HandoffSync {
    param([string]$Repo, [string]$FilePath)
    if (-not $Repo) { $Repo = if ($env:CLAUDE_SYNC_REPO) { $env:CLAUDE_SYNC_REPO } else { Join-Path $HOME '.claude' } }
    $script = Join-Path $HOME '.claude\hooks\sync\claude-sync.sh'
    $bash = Get-GitBash
    if (-not (Test-Path -LiteralPath $script) -or -not $bash -or -not (Invoke-HandoffGit $Repo rev-parse --show-toplevel)) {
        "SKIPPED: no claude-config sync on this machine; copy the handoff by hand"
        return 0
    }
    $branchName = Invoke-HandoffGit $Repo symbolic-ref --quiet --short HEAD
    if (-not $branchName) { $branchName = 'main' }
    $rel = $null
    if ($FilePath) { $rel = [IO.Path]::GetFullPath($FilePath) -replace '\\', '/' }
    $savedRepo = $env:CLAUDE_SYNC_REPO
    $env:CLAUDE_SYNC_REPO = $Repo -replace '\\', '/'
    $reason = 'sync did not run'
    try {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            # claude-sync.sh skips silently while another run holds the lock.
            $lock = Join-Path $Repo '.sync.lock'
            for ($i = 0; $i -lt 30 -and (Test-Path -LiteralPath $lock); $i++) { Start-Sleep -Seconds 2 }
            & $bash ($script -replace '\\', '/') | Out-Null
            if ($null -eq (Invoke-HandoffGit $Repo fetch -q origin $branchName)) { $reason = 'fetch failed (offline?)'; continue }
            $head = Invoke-HandoffGit $Repo rev-parse HEAD
            $remote = Invoke-HandoffGit $Repo rev-parse "origin/$branchName"
            if ($head -ne $remote) { $reason = "HEAD $head differs from origin/$branchName $remote"; continue }
            if ($rel) {
                if ($null -eq (Invoke-HandoffGit $Repo ls-files --error-unmatch -- $rel)) { $reason = "handoff not tracked; check the .gitignore allowlist"; continue }
                if (Invoke-HandoffGit $Repo status --porcelain -- $rel) { $reason = 'handoff has uncommitted changes'; continue }
            }
            "SYNCED: $($head.Substring(0, 8)) on origin/$branchName"
            return 0
        }
    } finally {
        $env:CLAUDE_SYNC_REPO = $savedRepo
    }
    "NOT SYNCED: $reason; see $(Join-Path $Repo 'sync.log')"
    return 1
}

function Invoke-HandoffWipPush {
    param([string]$Path, [string]$Name)
    $top = Invoke-HandoffGit $Path rev-parse --show-toplevel
    if (-not $top) { "NO-GIT: $Path is not in a Git repository"; return 0 }
    $head = Invoke-HandoffGit $top rev-parse HEAD
    if (-not $head) { "NO-COMMITS: $top has no commits"; return 1 }
    $baseName = Invoke-HandoffGit $top symbolic-ref --quiet --short HEAD
    if (-not $baseName) { $baseName = 'detached' }
    $dirty = Invoke-HandoffGit $top status --porcelain
    $onRemote = Invoke-HandoffGit $top branch -r --contains HEAD
    if (-not $dirty -and $onRemote) { "CLEAN: $baseName at $head is on the remote"; return 0 }
    if (-not (Invoke-HandoffGit $top remote get-url origin)) { "NO-REMOTE: $top has no origin; changes stay on $([Environment]::MachineName)"; return 1 }
    $commit = $head
    if ($dirty) {
        # Snapshot through a temporary index so the real index, branch and worktree stay untouched.
        $index = Invoke-HandoffGit $top rev-parse --path-format=absolute --git-path index
        $tmp = [IO.Path]::GetTempFileName()
        Copy-Item -LiteralPath $index -Destination $tmp -Force
        $savedIndex = $env:GIT_INDEX_FILE
        $env:GIT_INDEX_FILE = $tmp
        try {
            Invoke-HandoffGit $top add -A | Out-Null
            $tree = Invoke-HandoffGit $top write-tree
        } finally {
            $env:GIT_INDEX_FILE = $savedIndex
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        }
        if (-not $tree) { "FAILED: could not snapshot the working tree"; return 1 }
        $commit = Invoke-HandoffGit $top commit-tree $tree -p $head -m "wip: session handoff $Name from $([Environment]::MachineName)"
        if (-not $commit) { "FAILED: commit-tree failed (user.name/user.email set?)"; return 1 }
    }
    $safe = ($Name.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    if (-not $safe) { $safe = 'handoff' }
    $wip = "wip/$safe-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    if ($null -eq (Invoke-HandoffGit $top push -q origin "${commit}:refs/heads/$wip")) { "FAILED: push of $wip rejected"; return 1 }
    "PUSHED: branch=$wip commit=$commit parent=$head base=$baseName"
    return 0
}

function Invoke-HandoffWipRestore {
    param([string]$Path, [string]$WipBranch, [string]$BaseName, [string]$ParentSha)
    $top = Invoke-HandoffGit $Path rev-parse --show-toplevel
    if (-not $top) { "BLOCKED: $Path is not in a Git repository"; return 1 }
    if (Invoke-HandoffGit $top status --porcelain) { "BLOCKED: uncommitted changes on this machine; commit or stash them first"; return 1 }
    if ($null -eq (Invoke-HandoffGit $top fetch -q origin "refs/heads/${WipBranch}:refs/remotes/origin/$WipBranch")) { "BLOCKED: fetch of $WipBranch failed"; return 1 }
    $commit = Invoke-HandoffGit $top rev-parse "origin/$WipBranch"
    if ($BaseName -eq 'detached') {
        if ($null -eq (Invoke-HandoffGit $top switch -q --detach $ParentSha)) { "BLOCKED: cannot check out $ParentSha"; return 1 }
    } else {
        if ($null -ne (Invoke-HandoffGit $top rev-parse --verify --quiet "refs/heads/$BaseName")) {
            if ($null -eq (Invoke-HandoffGit $top switch -q $BaseName)) { "BLOCKED: cannot switch to $BaseName"; return 1 }
        } elseif ($null -eq (Invoke-HandoffGit $top switch -q -c $BaseName $ParentSha)) { "BLOCKED: cannot create $BaseName at $ParentSha"; return 1 }
        if ((Invoke-HandoffGit $top rev-parse HEAD) -ne $ParentSha -and $null -eq (Invoke-HandoffGit $top merge -q --ff-only $ParentSha)) {
            "BLOCKED: local $BaseName has commits that are not in the handoff; resolve by hand"; return 1
        }
    }
    # Merge the WIP onto HEAD in memory with the parent as base, so commits after the parent are kept.
    $merge = @(& git.exe -C $top merge-tree --write-tree --name-only --no-messages "--merge-base=$ParentSha" HEAD $commit 2>$null)
    if ($LASTEXITCODE -eq 1) {
        $paths = ($merge | Select-Object -Skip 1 | Where-Object { $_ } | Select-Object -Unique) -join ', '
        "BLOCKED: $BaseName changed after $ParentSha in the same lines as $WipBranch ($paths); merge by hand"; return 1
    }
    if ($LASTEXITCODE -ne 0) { "BLOCKED: merge of $WipBranch onto $BaseName failed"; return 1 }
    $tree = [string]$merge[0]
    if ($tree -eq (Invoke-HandoffGit $top rev-parse 'HEAD^{tree}')) { "ALREADY-CONTAINED: $BaseName already holds $WipBranch"; return 0 }
    # No-overlay restore: files deleted on the other machine are deleted here too.
    if ($null -eq (Invoke-HandoffGit $top restore "--source=$tree" --worktree -- .)) { "BLOCKED: restore from $commit failed"; return 1 }
    "RESTORED: $BaseName at $(Invoke-HandoffGit $top rev-parse HEAD) with $WipBranch as uncommitted changes"
    return 0
}

if (-not $Action) { return }
if (-not $Cwd) { $Cwd = (Get-Location).Path }

$code = 0
switch ($Action) {
    'Slug' { Get-HandoffSlug $Cwd }
    'Prepare' { Invoke-HandoffPrepare $Cwd $HandoffRoot $KeepDays }
    'Sync' { Invoke-HandoffSync $ConfigRepo $File | ForEach-Object { if ($_ -is [int]) { $code = $_ } else { $_ } } }
    'WipPush' { Invoke-HandoffWipPush $Cwd $Topic | ForEach-Object { if ($_ -is [int]) { $code = $_ } else { $_ } } }
    'WipRestore' { Invoke-HandoffWipRestore $Cwd $Branch $Base $Parent | ForEach-Object { if ($_ -is [int]) { $code = $_ } else { $_ } } }
    default { "Unknown -Action '$Action'. Use Slug, Prepare, Sync, WipPush or WipRestore."; $code = 2 }
}
exit $code
