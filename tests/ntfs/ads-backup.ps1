# Standalone NTFS diagnostic laboratory. Creates only fictional files; retains all outputs.
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $repo 'tools\diagnoseNtfs.ps1') -LibraryOnly
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class SyntheticNtfsIo {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    public static void WriteNew(string name, byte[] bytes) {
        using(var handle=CreateFileW(name,0x40000000,0,IntPtr.Zero,1,0x02000000,IntPtr.Zero)) {
            if(handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            using(var stream=new FileStream(handle,FileAccess.Write)) { stream.Write(bytes,0,bytes.Length); }
        }
    }
    public static string Hash(string name) {
        using(var handle=CreateFileW(name,0x80000000,1,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
            if(handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            using(var stream=new FileStream(handle,FileAccess.Read))
            using(var hash=SHA256.Create()) { return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
        }
    }
}
'@
$lab = Join-Path $repo ('test-results\ntfs-ads-synthetic-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $lab) { throw 'E_SYNTHETIC_EXISTING_LAB' }
[IO.Directory]::CreateDirectory($lab) | Out-Null
[IO.File]::WriteAllText((Join-Path $lab 'SYNTHETIC-ONLY.marker'), 'No real project data. Keep this laboratory for review.')
$source = Join-Path $lab 'source'
$backup = Join-Path $lab 'backup'
$restored = Join-Path $lab 'restored'
$checks = [Collections.Generic.List[object]]::new()
function Check([string] $Name, [bool] $Pass) {
    $checks.Add(@{ Name=$Name; Passed=$Pass })
    if (-not $Pass) { throw ('E_SYNTHETIC_CHECK_' + $Name) }
}
function Write-New([string] $Target, [byte[]] $Bytes) {
    if ($null -eq $Bytes) { $Bytes = [byte[]]@() }
    if (-not $Target.StartsWith($lab + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'E_SYNTHETIC_WRITE_OUTSIDE_LAB' }
    [SyntheticNtfsIo]::WriteNew($Target,$Bytes)
}
function Hash-Synthetic([string] $Target) {
    # This helper can hash only the newly created laboratory, never a real source path.
    if (-not $Target.StartsWith($lab + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'E_SYNTHETIC_HASH_OUTSIDE_LAB' }
    return [SyntheticNtfsIo]::Hash($Target)
}
function Snapshot-Synthetic([string] $Root) {
    if (-not $Root.StartsWith($lab + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'E_SYNTHETIC_SNAPSHOT_OUTSIDE_LAB' }
    $tree = Get-NtfsTree $Root
    if ($tree.Errors.Count) { throw 'E_SYNTHETIC_STREAM_ENUMERATION' }
    $entries = @()
    foreach ($row in @($tree.Rows | Sort-Object Relative)) {
        $info = Get-Item -Force -LiteralPath $row.FullName
        $streams = @()
        foreach ($stream in @($row.Streams | Sort-Object Name)) {
            if ($stream.Name -ceq '::$DATA') { continue }
            if (-not $stream.Name.StartsWith(':') -or -not $stream.Name.EndsWith(':$DATA')) { throw 'E_SYNTHETIC_STREAM_NAME' }
            $adsName = $stream.Name.Substring(1,$stream.Name.Length-7)
            $streams += [ordered]@{ Name=$stream.Name; Bytes=$stream.Bytes; Sha256=(Hash-Synthetic ($row.FullName + ':' + $adsName)) }
        }
        $entries += [ordered]@{ Path=$row.Relative; Directory=$row.Directory; Attributes=($row.Attributes -band 39); CreationUtc=$info.CreationTimeUtc.Ticks; ModifiedUtc=$info.LastWriteTimeUtc.Ticks; MainSha256=$(if ($row.Directory) { $null } else { Hash-Synthetic $row.FullName }); Streams=$streams }
    }
    return ConvertTo-Json -InputObject @($entries) -Depth 7 -Compress
}
function Copy-Synthetic([string] $From, [string] $To) {
    foreach ($p in @($From,$To)) { if (-not $p.StartsWith($lab + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'E_SYNTHETIC_COPY_OUTSIDE_LAB' } }
    if (Test-Path -LiteralPath $To) { throw 'E_SYNTHETIC_COPY_EXISTS' }
    & (Join-Path $env:SystemRoot 'System32\robocopy.exe') $From $To /E /COPY:DAT /DCOPY:DAT /XJ /R:0 /W:0 /NP /NFL /NDL /NJH /NJS > (Join-Path $lab ([IO.Path]::GetFileName($To) + '-robocopy.log'))
    $result = $LASTEXITCODE
    if ($result -lt 0 -or $result -ge 8) { throw 'E_SYNTHETIC_ROBOCOPY' }
    return $result
}
try {
    [IO.Directory]::CreateDirectory($source) | Out-Null
    $data = [Text.Encoding]::UTF8.GetBytes('SYNTHETIC-ONLY')
    foreach ($relative in @('.env','.git/index','.git/objects/aa/fake','assets/fixture.json','untracked.txt','hidden.bin','with [brackets] & spaces.txt','empty-main.bin')) {
        $p=Join-Path $source $relative
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p)) | Out-Null
        Write-New $p $(if ($relative -eq 'empty-main.bin') { [byte[]]@() } else { $data })
    }
    [IO.Directory]::CreateDirectory((Join-Path $source 'empty-dir')) | Out-Null
    [IO.File]::SetAttributes((Join-Path $source 'hidden.bin'),[IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::Archive)
    [IO.File]::SetAttributes((Join-Path $source '.git'),[IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::Directory)
    $ads = @(
        @{ Path='assets/fixture.json'; Name='Zone.Identifier'; Bytes=([Text.Encoding]::UTF8.GetBytes("[ZoneTransfer]`r`nZoneId=3`r`n")) },
        @{ Path='assets/fixture.json'; Name='synthetic-meta'; Bytes=([byte[]]@(0,1,2,255)) },
        @{ Path='.env'; Name='synthetic-meta'; Bytes=$data },
        @{ Path='.git/index'; Name='synthetic-meta'; Bytes=$data },
        @{ Path='hidden.bin'; Name='synthetic-meta'; Bytes=$data },
        @{ Path='with [brackets] & spaces.txt'; Name='empty-ads'; Bytes=([byte[]]@()) },
        @{ Path='empty-dir'; Name='directory-meta'; Bytes=$data },
        @{ Path=''; Name='root-meta'; Bytes=$data }
    )
    foreach ($s in $ads) {
        $target = if ($s.Path) { Join-Path $source $s.Path } else { $source }
        Write-New ($target + ':' + $s.Name) $s.Bytes
    }
    $summary = Get-NtfsSummary (Get-NtfsTree $source)
    Check 'all-8-file-and-directory-ADS-detected-including-empty' ($summary.AdditionalStreams -eq 8 -and $summary.FilesWithAdditionalStreams -eq 5 -and $summary.DirectoriesWithAdditionalStreams -eq 2)
    $ordinary = Join-Path $source 'untracked.txt'
    $standard=@(Get-Item -LiteralPath $ordinary -Stream * | Where-Object { $_.Stream -ne ':$DATA' })
    Check 'PowerShell-standard-stream-not-misclassified' ($standard.Count -eq 0)
    $named=@(Get-Item -LiteralPath (Join-Path $source 'assets/fixture.json') -Stream * | Where-Object { $_.Stream -ne ':$DATA' })
    Check 'PowerShell-detects-two-real-named-streams' ($named.Count -eq 2)
    $hiddenAds=@(Get-Item -Force -LiteralPath (Join-Path $source 'hidden.bin') -Stream * | Where-Object { $_.Stream -ne ':$DATA' })
    Check 'hidden-file-ADS-enumeration-with-Force' ($hiddenAds.Count -eq 1)
    # PowerShell 5.1 emits ConvertFrom-Json arrays as one pipeline object.
    $fakeRequiredJson=ConvertTo-Json -InputObject @(1..114 | ForEach-Object { 'fictitious-' + $_ }) -Compress
    $oldRequiredCount=@($fakeRequiredJson | ConvertFrom-Json).Count
    $parsedRequired=$fakeRequiredJson | ConvertFrom-Json
    Check 'coverage-count-114-after-explicit-array-assignment' ($oldRequiredCount -eq 1 -and @($parsedRequired).Count -eq 114)
    $before=Snapshot-Synthetic $source
    $copyExit=Copy-Synthetic $source $backup
    Check 'backup-bytes-ADS-directories-hidden-and-attributes-identical' ($before -ceq (Snapshot-Synthetic $backup))
    $restoreExit=Copy-Synthetic $backup $restored
    Check 'restore-bytes-ADS-directories-hidden-and-attributes-identical' ($before -ceq (Snapshot-Synthetic $restored))
    Check 'source-unchanged-after-copy-and-restore' ($before -ceq (Snapshot-Synthetic $source))
    # Existing verifier covers only main file streams. Show its gap using synthetic bytes.
    $env:CARTE_SYNTHETIC_LAB=$lab
    $env:CARTE_SYNTHETIC_REPO=$repo
    $probe=@'
const fs=require('node:fs'),path=require('node:path');
const lab=process.env.CARTE_SYNTHETIC_LAB;
const b=require(path.join(process.env.CARTE_SYNTHETIC_REPO,'tools/localBackupManifest.js'));
(async()=>{
 const a=path.join(lab,'legacy-before.json'),z=path.join(lab,'legacy-after.json');
 const root=path.join(lab,'restored');
 await b.manifest(root,a,{privacyCheck:()=>{}}); // Synthetic laboratory ONLY.
 const ads=path.join(root,'assets/fixture.json')+':synthetic-meta';
 fs.writeFileSync(ads,Buffer.from([255,2,1,0])); // Same ADS size, changed synthetic bytes.
 await b.manifest(root,z,{privacyCheck:()=>{}});
 if(!b.compare(a,z).matched)process.exitCode=1;
})().catch(()=>process.exitCode=2);
'@
    $probe | & node -
    Check 'legacy-main-stream-verifier-does-not-detect-ADS-corruption' ($LASTEXITCODE -eq 0)
    Check 'supplemental-SHA256-verifier-detects-same-size-ADS-corruption' ($before -cne (Snapshot-Synthetic $restored))
    Check 'original-backup-still-intact-after-negative-test' ($before -ceq (Snapshot-Synthetic $backup))
    # A newly created file with identical main bytes and no ADS must differ too.
    $missing=Join-Path $lab 'missing-ads'
    [IO.Directory]::CreateDirectory($missing) | Out-Null
    $file=Join-Path $missing 'fixture.json'
    Write-New $file $data
    $originalFile=Join-Path $source 'assets/fixture.json'
    function Stream-Signature([string] $Target) {
        $view=@([CarteNtfs.Streams]::Read($Target) | Where-Object { $_.Name -cne '::$DATA' } | Sort-Object Name | ForEach-Object {
            [ordered]@{ Name=$_.Name; Bytes=$_.Bytes; Hash=(Hash-Synthetic ($Target + $_.Name.Substring(0,$_.Name.Length-6))) }
        })
        return ConvertTo-Json -InputObject $view -Compress
    }
    Check 'missing-ADS-detected-even-with-identical-main-bytes' ((Hash-Synthetic $file) -ceq (Hash-Synthetic $originalFile) -and (Stream-Signature $file) -cne (Stream-Signature $originalFile))
    $unexpected=Join-Path $lab 'unexpected-ads'
    [IO.Directory]::CreateDirectory($unexpected) | Out-Null
    $unexpectedFile=Join-Path $unexpected 'fixture.json'
    Write-New $unexpectedFile $data
    foreach ($s in @($ads | Where-Object { $_.Path -eq 'assets/fixture.json' })) { Write-New ($unexpectedFile + ':' + $s.Name) $s.Bytes }
    Check 'per-file-stream-signatures-match-before-negative-addition' ((Stream-Signature $unexpectedFile) -ceq (Stream-Signature $originalFile))
    Write-New ($unexpectedFile + ':unexpected-synthetic') $data
    Check 'unexpected-ADS-detected' ((Hash-Synthetic $unexpectedFile) -ceq (Hash-Synthetic $originalFile) -and (Stream-Signature $unexpectedFile) -cne (Stream-Signature $originalFile))
    $report=[ordered]@{ Laboratory=$lab; SyntheticOnly=$true; ExistingAclChanged=$false; FilesDeleted=$false; RobocopyBackupExit=$copyExit; RobocopyRestoreExit=$restoreExit; Source=$summary; Checks=@($checks); Passed=$checks.Count; Failed=0; LegacyVerifierAdsGapConfirmed=$true }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $lab 'result.json')
    $report | ConvertTo-Json -Depth 8
} catch {
    [ordered]@{ SyntheticOnly=$true; Laboratory=$lab; Failed=$true; Checks=@($checks); Message=$_.Exception.Message } | ConvertTo-Json -Depth 5
    exit 1
}
