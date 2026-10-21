# Synthetic end-to-end tests of the production backup verifiers. No cleanup.
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $repo 'tools\localBackupNtfs.ps1') -LibraryOnly
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class BackupTestIo {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    public static void Write(string path,byte[] bytes,bool replace) {
        using(var handle=CreateFileW(path,0x40000000,0,IntPtr.Zero,replace?2u:1u,0x02000000,IntPtr.Zero)) {
            if(handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            using(var file=new FileStream(handle,FileAccess.Write)) { file.Write(bytes,0,bytes.Length); }
        }
    }
    public static SafeFileHandle Writer(string path) {
        var handle=CreateFileW(path,0x40000000,3,IntPtr.Zero,3,0x02000000,IntPtr.Zero);
        if(handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        return handle;
    }
}
'@
$lab=Join-Path $repo ('test-results\backup-ntfs-tests-'+[guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $lab) { throw 'E_TEST_EXISTING_LAB' }
[IO.Directory]::CreateDirectory($lab) | Out-Null
[IO.File]::WriteAllText((Join-Path $lab 'SYNTHETIC-ONLY.marker'),'Fictional files only. Retained for review.')
$checks=[Collections.Generic.List[object]]::new()
function Check([string] $Name,[bool] $Passed) {
    $checks.Add(@{ Name=$Name; Passed=$Passed })
    if (-not $Passed) { throw ('E_TEST_CHECK_'+$Name) }
}
function Reject([string] $Name,[scriptblock] $Action,[string] $Code) {
    $caught=$null
    try { & $Action | Out-Null } catch { $caught=$_.Exception.Message }
    Check $Name ($caught -eq $Code)
}
function New-Private([string] $Path,[switch] $Broad) {
    if (-not $Path.StartsWith($lab+'\',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $Path)) { throw 'E_TEST_PRIVATE_PATH' }
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $sids=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
    foreach ($sid in $sids) {
        $identity=[Security.Principal.SecurityIdentifier]::new($sid)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    }
    if ($Broad) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')) }
    [IO.Directory]::CreateDirectory($Path,$acl) | Out-Null
}
function Write-Fake([string] $Path,[byte[]] $Bytes,[switch] $Replace) {
    if (-not $Path.StartsWith($lab+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'E_TEST_WRITE_OUTSIDE_LAB' }
    if ($null -eq $Bytes) { $Bytes=[byte[]]@() }
    [BackupTestIo]::Write($Path,$Bytes,[bool]$Replace)
}
function Save-Json([string] $Path,$Value) {
    Write-Fake $Path ([Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $Value -Depth 12)+"`n"))
}
function Main([string] $Tree,[string] $Name) {
    $out=Join-Path $control ($Name+'.main.json')
    $null=& node (Join-Path $repo 'tools\localBackupManifest.js') manifest $Tree $out
    if ($LASTEXITCODE -ne 0) { throw 'E_TEST_MAIN_MANIFEST' }
    return $out
}
function Ntfs([string] $Tree,[string] $Main,[string] $Name) {
    $out=Join-Path $control ($Name+'.ntfs.json')
    $null=New-BackupNtfsManifest $Tree $Main $out
    return $out
}
function Pair([string] $Tree,[string] $Name) {
    $m=Main $Tree $Name
    $n=Ntfs $Tree $m $Name
    return @{ Main=$m; Ntfs=$n }
}
function Same-Main([string] $A,[string] $B,[switch] $State) {
    $nodeArguments=@((Join-Path $repo 'tools\localBackupManifest.js'),'compare',$A,$B)
    if ($State) { $nodeArguments+='--source-state' }
    $null=& node @nodeArguments
    if ($LASTEXITCODE -ne 0) { throw 'E_TEST_MAIN_MISMATCH' }
}
function Copy-Fake([string] $From,[string] $To) {
    foreach ($p in @($From,$To)) { if (-not $p.StartsWith($lab+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'E_TEST_COPY_OUTSIDE_LAB' } }
    if (Test-Path -LiteralPath $To) { throw 'E_TEST_COPY_EXISTS' }
    & (Join-Path $env:SystemRoot 'System32\robocopy.exe') $From $To /E /COPY:DAT /DCOPY:DAT /XJ /R:0 /W:0 /NP /NFL /NDL /NJH /NJS > (Join-Path $lab ([guid]::NewGuid().ToString('N')+'.copy.log'))
    if ($LASTEXITCODE -lt 0 -or $LASTEXITCODE -ge 8) { throw 'E_TEST_COPY' }
}
function Acls([string] $Tree) {
    $rows=Get-NtfsTree $Tree
    if ($rows.Errors.Count) { throw 'E_TEST_ACL_ENUMERATION' }
    $aclRows=@($rows.Rows | Sort-Object -CaseSensitive Relative | ForEach-Object { [ordered]@{ Path=$_.Relative; Sddl=(Get-Acl -LiteralPath $_.FullName).Sddl } })
    return ConvertTo-Json -InputObject $aclRows -Compress
}
try {
    New-Private (Join-Path $lab 'private')
    $control=Join-Path $lab 'private\control'; [IO.Directory]::CreateDirectory($control) | Out-Null
    $source=Join-Path $lab 'source'; [IO.Directory]::CreateDirectory($source) | Out-Null
    $backup=Join-Path $lab 'private\backup'; $restored=Join-Path $lab 'private\restored'
    $required=@(1..114 | ForEach-Object { 'records/fictitious-'+$_.ToString('000')+'.bin' })
    $bytes=[Text.Encoding]::UTF8.GetBytes('SYNTHETIC-ONLY')
    foreach ($p in $required+@('.git/index','.git/objects/aa/fake','.env','hidden-system.bin','read-only.bin','untracked.bin','empty-main.bin')) {
        $target=Join-Path $source $p
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        Write-Fake $target $(if ($p -eq 'empty-main.bin') { [byte[]]@() } else { $bytes })
    }
    [IO.Directory]::CreateDirectory((Join-Path $source 'empty-dir')) | Out-Null
    [IO.File]::SetAttributes((Join-Path $source 'hidden-system.bin'),[IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System -bor [IO.FileAttributes]::Archive)
    [IO.File]::SetAttributes((Join-Path $source 'read-only.bin'),[IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::Archive)
    [IO.File]::SetAttributes((Join-Path $source '.env'),[IO.FileAttributes]::NotContentIndexed -bor [IO.FileAttributes]::Archive)
    [IO.File]::SetAttributes((Join-Path $source '.git'),[IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::Directory)
    $ads=@(
        @{ Path='records/fictitious-001.bin'; Name='Zone.Identifier'; Bytes=$bytes },
        @{ Path='records/fictitious-001.bin'; Name='binary'; Bytes=([byte[]]@(0,1,2,255)) },
        @{ Path='.git/index'; Name='fictitious'; Bytes=$bytes },
        @{ Path='.env'; Name='empty'; Bytes=([byte[]]@()) },
        @{ Path='hidden-system.bin'; Name='fictitious'; Bytes=$bytes },
        @{ Path='empty-dir'; Name='fictitious'; Bytes=$bytes },
        @{ Path=''; Name='root'; Bytes=$bytes }
    )
    foreach ($s in $ads) { $p=if ($s.Path) { Join-Path $source $s.Path } else { $source }; Write-Fake ($p+':'+$s.Name) $s.Bytes }
    $beforeAcl=Acls $source
    $null=Assert-BackupPrivateTree (Join-Path $lab 'private')
    Check 'private-vault-ACL-accepted' $true
    New-Private (Join-Path $lab 'broad') -Broad
    Reject 'broad-ACL-rejected' { Assert-BackupPrivateTree (Join-Path $lab 'broad') } 'E_NTFS_PRIVATE_ACL'
    $expected=@(0,1,3,114)
    foreach ($n in $expected) {
        $list=@(); if ($n) { $list=@($required | Select-Object -First $n) }
        $p=Join-Path $control ('required-'+$n+'.json'); Save-Json $p $list
        $count=Get-BackupRequiredPaths $p $n
        Check ('PS51-count-'+$n) ($count.Count -eq $n -and @($count.Paths).Count -eq $n)
        if ($n -ne 114) { Reject ('coverage-refuses-required-count-'+$n) { Assert-BackupCoverage (Join-Path $control 'not-read.json') $p } 'E_NTFS_REQUIRED_COUNT' }
    }
    $requiredFile=Join-Path $control 'required-114.json'
    $largeMetadata=[ordered]@{ format=1; directories=@(); entries=@(); syntheticPadding=('x'*(3*1024*1024)) }
    $largeMetadataFile=Join-Path $control 'large-synthetic-metadata.main.json'; Save-Json $largeMetadataFile $largeMetadata
    $readLarge=Read-BackupMain $largeMetadataFile
    Check 'PS51-parses-manifest-larger-than-2MiB' ($readLarge.syntheticPadding.Length -eq 3*1024*1024)
    Save-Json (Join-Path $control 'duplicate.json') @('same','SAME')
    Reject 'duplicate-case-alias-required-path-refused' { Get-BackupRequiredPaths (Join-Path $control 'duplicate.json') 2 } 'E_NTFS_REQUIRED_PATH'
    Save-Json (Join-Path $control 'not-array.json') 'one'
    Reject 'JSON-scalar-not-array-refused' { Get-BackupRequiredPaths (Join-Path $control 'not-array.json') 1 } 'E_NTFS_REQUIRED_FORMAT'
    $plan=Get-BackupNtfsPlan $source
    Check 'plan-counts-all-7-ADS-without-reading-content' ($plan.AdditionalStreams -eq 7 -and -not $plan.ContentsRead)
    $before=Pair $source 'before'
    $null=Assert-BackupCoverage $before.Main $requiredFile
    Check 'source-coverage-114-of-114' $true
    $incomplete=Read-BackupMain $before.Main; $incomplete.entries=@($incomplete.entries | Where-Object { $_.path -ne $required[0] })
    $incompleteFile=Join-Path $control 'incomplete.main.json'; Save-Json $incompleteFile $incomplete
    Reject 'coverage-refuses-one-missing-path-out-of-114' { Assert-BackupCoverage $incompleteFile $requiredFile } 'E_NTFS_COVERAGE'
    Copy-Fake $source $backup
    $null=Assert-BackupPrivateTree $backup
    $copied=Pair $backup 'copy'
    Same-Main $before.Main $copied.Main
    $null=Compare-BackupNtfs $before.Ntfs $before.Main $copied.Ntfs $copied.Main
    Check 'backup-all-main-bytes-ADS-attributes-times-hidden-system-Git' $true
    $null=Assert-BackupCoverage $copied.Main $requiredFile
    Check 'backup-coverage-114-of-114' $true
    Copy-Fake $backup $restored
    $null=Assert-BackupPrivateTree $restored
    $restore=Pair $restored 'restore'
    Same-Main $before.Main $restore.Main
    $null=Compare-BackupNtfs $before.Ntfs $before.Main $restore.Ntfs $restore.Main
    Check 'restore-all-main-bytes-ADS-attributes-times-hidden-system-Git' $true
    $null=Assert-BackupCoverage $restore.Main $requiredFile
    Check 'restore-coverage-114-of-114' $true
    $after=Pair $source 'after'
    Same-Main $before.Main $after.Main -State
    $null=Compare-BackupNtfs $before.Ntfs $before.Main $after.Ntfs $after.Main -SourceState
    Check 'source-state-and-ADS-unchanged-after-copy-and-restore' $true
    Check 'source-ACLs-unchanged' ($beforeAcl -ceq (Acls $source))
    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $source /save (Join-Path $control 'source-acls.private.txt') /T /Q > (Join-Path $control 'acl-export.private.log') 2>&1
    Check 'original-DACL-export-succeeded-without-changing-source' ($LASTEXITCODE -eq 0 -and $beforeAcl -ceq (Acls $source))
    & (Join-Path $env:SystemRoot 'System32\icacls.exe') $source /save (Join-Path $control 'source-acls-final.private.txt') /T /Q > (Join-Path $control 'acl-export-final.private.log') 2>&1
    Check 'two-complete-DACL-exports-identical' ($LASTEXITCODE -eq 0 -and (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $control 'source-acls.private.txt')).Hash -ceq (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $control 'source-acls-final.private.txt')).Hash)
    Reject 'existing-manifest-never-overwritten' { New-BackupNtfsManifest $source $before.Main $before.Ntfs } 'E_NTFS_OUTPUT_EXISTS'
    Reject 'manifest-output-outside-private-ACL-refused' { New-BackupNtfsManifest $source $before.Main (Join-Path $lab 'broad\forbidden.json') } 'E_NTFS_PRIVATE_ACL'
    $tampered=Join-Path $control 'tampered.main.json'
    Write-Fake $tampered ([Text.UTF8Encoding]::new($false).GetBytes(([IO.File]::ReadAllText($before.Main))+"`n"))
    Reject 'main-manifest-checksum-binding-enforced' { Read-BackupNtfs $before.Ntfs $tampered } 'E_NTFS_MANIFEST_BINDING'
    $streamTarget=(Join-Path $restored 'records/fictitious-001.bin')+':binary'
    Write-Fake $streamTarget ([byte[]]@(255,2,1,0)) -Replace
    $corrupt=Pair $restored 'corrupt'
    Same-Main $before.Main $corrupt.Main
    Reject 'same-size-ADS-corruption-refused-by-production-comparer' { Compare-BackupNtfs $before.Ntfs $before.Main $corrupt.Ntfs $corrupt.Main } 'E_NTFS_MANIFEST_MISMATCH'
    Write-Fake $streamTarget ([byte[]]@(1,2,3,4,5)) -Replace
    $size=Pair $restored 'size'
    Reject 'different-ADS-size-refused' { Compare-BackupNtfs $before.Ntfs $before.Main $size.Ntfs $size.Main } 'E_NTFS_MANIFEST_MISMATCH'
    Write-Fake ((Join-Path $restored '.env')+':unexpected') $bytes
    $added=Pair $restored 'added'
    Reject 'unexpected-ADS-refused' { Compare-BackupNtfs $size.Ntfs $size.Main $added.Ntfs $added.Main } 'E_NTFS_MANIFEST_MISMATCH'
    $missing=Get-Content -Raw -Encoding UTF8 -LiteralPath $before.Ntfs | ConvertFrom-Json
    ($missing.Nodes | Where-Object { $_.Path -eq '.env' }).Streams=@()
    $missingFile=Join-Path $control 'missing.ntfs.json'; Save-Json $missingFile $missing
    Reject 'missing-empty-ADS-refused' { Compare-BackupNtfs $before.Ntfs $before.Main $missingFile $before.Main } 'E_NTFS_MANIFEST_MISMATCH'
    # Physical absence, without removing any stream: two new otherwise identical trees.
    $hasAds=Join-Path $lab 'physical-has-ads'; $noAds=Join-Path $lab 'physical-no-ads'
    foreach ($p in @($hasAds,$noAds)) { [IO.Directory]::CreateDirectory($p) | Out-Null; Write-Fake (Join-Path $p 'fixture.bin') $bytes }
    Write-Fake ((Join-Path $hasAds 'fixture.bin')+':empty') ([byte[]]@())
    [IO.File]::SetCreationTimeUtc((Join-Path $noAds 'fixture.bin'),[IO.File]::GetCreationTimeUtc((Join-Path $hasAds 'fixture.bin')))
    [IO.File]::SetLastWriteTimeUtc((Join-Path $noAds 'fixture.bin'),[IO.File]::GetLastWriteTimeUtc((Join-Path $hasAds 'fixture.bin')))
    [IO.Directory]::SetCreationTimeUtc($noAds,[IO.Directory]::GetCreationTimeUtc($hasAds))
    [IO.Directory]::SetLastWriteTimeUtc($noAds,[IO.Directory]::GetLastWriteTimeUtc($hasAds))
    $has=Pair $hasAds 'physical-has'; $none=Pair $noAds 'physical-none'
    Same-Main $has.Main $none.Main
    Reject 'physical-ADS-absence-with-identical-main-bytes-refused' { Compare-BackupNtfs $has.Ntfs $has.Main $none.Ntfs $none.Main } 'E_NTFS_MANIFEST_MISMATCH'
    $writer=[BackupTestIo]::Writer((Join-Path $source 'records/fictitious-001.bin')+':binary')
    try { Reject 'concurrent-writer-blocks-ADS-read' { Get-BackupNtfsRecords $source -HashStreams } 'E_NTFS_STREAM_READ_OR_CHANGED' } finally { $writer.Dispose() }
    $mutation={ Write-Fake ((Join-Path $source 'records/fictitious-001.bin')+':binary') ([byte[]]@(255,2,1,0)) -Replace }
    Reject 'source-ADS-change-during-manifest-refused' { New-BackupNtfsManifest $source $before.Main (Join-Path $control 'race.ntfs.json') -BeforeFinalRead $mutation } 'E_NTFS_SOURCE_CHANGED'
    Check 'failed-source-check-produces-no-manifest' (-not (Test-Path -LiteralPath (Join-Path $control 'race.ntfs.json')))
    $cli=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $repo 'tools\localBackupNtfs.ps1') -Command coverage -MainManifest $copied.Main -RequiredFile $requiredFile
    Check 'production-CLI-coverage-on-PS51' ($LASTEXITCODE -eq 0 -and ($cli | ConvertFrom-Json).Covered)
    $cliFile=Join-Path $control 'cli.ntfs.json'
    $cli=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $repo 'tools\localBackupNtfs.ps1') -Command manifest -Root $backup -MainManifest $copied.Main -Output $cliFile
    Check 'production-CLI-manifest-on-PS51' ($LASTEXITCODE -eq 0 -and ($cli | ConvertFrom-Json).AdditionalStreams -eq 7)
    $cli=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $repo 'tools\localBackupNtfs.ps1') -Command compare -Output $before.Ntfs -MainManifest $before.Main -Other $cliFile -OtherMainManifest $copied.Main
    Check 'production-CLI-compare-on-PS51' ($LASTEXITCODE -eq 0 -and ($cli | ConvertFrom-Json).Matched)
    $cli=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $repo 'tools\localBackupNtfs.ps1') -Command private-tree -Root $backup
    Check 'production-CLI-private-tree-on-PS51' ($LASTEXITCODE -eq 0 -and ($cli | ConvertFrom-Json).PrivateAclVerified)
    $cli=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $repo 'tools\localBackupNtfs.ps1') -Command plan -Root $backup
    Check 'production-CLI-plan-on-PS51' ($LASTEXITCODE -eq 0 -and ($cli | ConvertFrom-Json).AdditionalStreams -eq 7)
    $cli=& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -NonInteractive -File (Join-Path $repo 'tools\localBackupNtfs.ps1') -Command compare -Output $before.Ntfs -MainManifest $before.Main -Other $corrupt.Ntfs -OtherMainManifest $corrupt.Main
    Check 'production-CLI-negative-has-only-explicit-code' ($LASTEXITCODE -eq 1 -and $cli -ceq 'E_NTFS_MANIFEST_MISMATCH')
    $result=[ordered]@{ SyntheticOnly=$true; Laboratory=$lab; Passed=$checks.Count; Failed=0; Checks=@($checks); FilesDeleted=$false; ExistingSourceAclChanged=$false; ProductionPathsAccessed=$false }
    $result | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $lab 'result.json')
    $result | ConvertTo-Json -Depth 6
} catch {
    [ordered]@{ SyntheticOnly=$true; Laboratory=$lab; Passed=@($checks | Where-Object { $_.Passed }).Count; Failed=1; Checks=@($checks); Error=$_.Exception.Message; Line=$_.InvocationInfo.ScriptLineNumber } | ConvertTo-Json -Depth 6
    exit 1
}
