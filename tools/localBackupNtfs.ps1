param(
    [ValidateSet('plan','manifest','compare','coverage','private-tree')] [string] $Command,
    [string] $Root, [string] $MainManifest, [string] $Output,
    [string] $Other, [string] $OtherMainManifest, [string] $RequiredFile,
    [int] $ExpectedCount = 114, [switch] $SourceState, [switch] $LibraryOnly
)
# Complementary NTFS verification. No copying, deletion, Git or ACL modification.
$ErrorActionPreference = 'Stop'
$isNtfsLibrary=$LibraryOnly
. (Join-Path $PSScriptRoot 'diagnoseNtfs.ps1') -LibraryOnly
if (-not ('CarteBackup.StreamIO' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
namespace CarteBackup {
    public sealed class Digest { public long Bytes; public string Sha256; public string Identity; }
    public static class StreamIO {
        [StructLayout(LayoutKind.Sequential)] private struct Info {
            public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
            public System.Runtime.InteropServices.ComTypes.FILETIME Access;
            public System.Runtime.InteropServices.ComTypes.FILETIME Write;
            public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links; public uint IndexHigh; public uint IndexLow;
        }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)]
        [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
        private static Info State(SafeFileHandle handle) {
            Info i; if(!GetFileInformationByHandle(handle,out i)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if((i.Attributes & (0x400u|0x4000u|0x1000u))!=0 || i.Links!=1) throw new IOException("E_NTFS_UNSUPPORTED_HANDLE");
            return i;
        }
        private static string Identity(Info i) { return i.Volume+":"+i.IndexHigh+":"+i.IndexLow; }
        public static Digest Hash(string path,long expectedBytes) {
            // FILE_SHARE_READ denies concurrent writers/deletion while the stream is hashed.
            using(var handle=CreateFileW(path,0x80000000,1,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
                if(handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                Info before=State(handle);
                using(var stream=new FileStream(handle,FileAccess.Read))
                using(var hash=SHA256.Create()) {
                    if(stream.Length!=expectedBytes) throw new IOException("E_NTFS_STREAM_SIZE");
                    string sha=BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                    Info after=State(handle);
                    if(stream.Length!=expectedBytes || Identity(before)!=Identity(after) || before.Attributes!=after.Attributes || before.Write.dwHighDateTime!=after.Write.dwHighDateTime || before.Write.dwLowDateTime!=after.Write.dwLowDateTime) throw new IOException("E_NTFS_SOURCE_CHANGED");
                    return new Digest { Bytes=expectedBytes, Sha256=sha, Identity=Identity(before) };
                }
            }
        }
    }
}
'@
}
function Assert-BackupAbsolute([string] $Path) {
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path -notmatch '^[A-Za-z]:\\' -or $Path.Substring(2).Contains(':')) { throw 'E_NTFS_ABSOLUTE_LOCAL_PATH' }
    $full=[IO.Path]::GetFullPath($Path)
    $cursor=$full
    while ($cursor) {
        if (([IO.File]::Exists($cursor) -or [IO.Directory]::Exists($cursor)) -and ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint)) { throw 'E_NTFS_REPARSE_PATH' }
        $parent=[IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor=$parent.FullName
    }
    if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($full)).DriveFormat -ne 'NTFS') { throw 'E_NTFS_VOLUME_REQUIRED' }
    return $full
}
function Assert-BackupPrivate([string] $Path) {
    $Path=Assert-BackupAbsolute $Path
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed=@($sid,'S-1-5-18','S-1-5-32-544')
    $acl=Get-Acl -LiteralPath $Path
    $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin $allowed -or $acl.Access.Count -eq 0) { throw 'E_NTFS_PRIVATE_ACL' }
    $operatorFull=$false
    foreach ($ace in $acl.Access) {
        if ($ace.AccessControlType -eq 'Allow') {
            $id=$ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($id -notin $allowed) { throw 'E_NTFS_PRIVATE_ACL' }
            if ($id -eq $sid -and (($ace.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)) { $operatorFull=$true }
        }
    }
    if (-not $operatorFull) { throw 'E_NTFS_PRIVATE_ACL' }
}
function Assert-BackupPrivateTree([string] $Root) {
    $tree=Get-NtfsTree (Assert-BackupAbsolute $Root)
    if ($tree.Errors.Count) { throw 'E_NTFS_ENUMERATION' }
    foreach ($row in $tree.Rows) { Assert-BackupPrivate $row.FullName }
    return @{ PrivateAclVerified=$true; NodesChecked=$tree.Rows.Count }
}
function Read-BackupMain([string] $Path) {
    $Path=Assert-BackupAbsolute $Path
    $doc=Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
    if ($doc.format -ne 1 -or $null -eq $doc.entries -or $doc.entries -isnot [array] -or $null -eq $doc.directories -or $doc.directories -isnot [array]) { throw 'E_NTFS_MAIN_FORMAT' }
    return $doc
}
function Get-BackupRequiredPaths([string] $Path, [int] $ExpectedCount) {
    if ($ExpectedCount -lt 0) { throw 'E_NTFS_REQUIRED_COUNT' }
    $parsed=Get-Content -Raw -Encoding UTF8 -LiteralPath (Assert-BackupAbsolute $Path) | ConvertFrom-Json
    if ($null -eq $parsed -or $parsed -isnot [array]) { throw 'E_NTFS_REQUIRED_FORMAT' }
    $paths=@($parsed)
    if ($paths.Count -ne $ExpectedCount) { throw 'E_NTFS_REQUIRED_COUNT' }
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($p in $paths) {
        if ($p -isnot [string] -or -not $p -or $p -match '[\\:\x00-\x1f\x7f]' -or $p.StartsWith('/') -or @($p.Split('/') | Where-Object { $_ -in @('','.','..') }).Count -or -not $seen.Add($p)) { throw 'E_NTFS_REQUIRED_PATH' }
    }
    return [pscustomobject]@{ Count=$paths.Count; Paths=$paths }
}
function Assert-BackupCoverage([string] $MainManifest,[string] $RequiredFile,[int] $ExpectedCount=114) {
    if ($ExpectedCount -ne 114) { throw 'E_NTFS_REQUIRED_COUNT' }
    $required=Get-BackupRequiredPaths $RequiredFile $ExpectedCount
    $doc=Read-BackupMain $MainManifest
    $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($entry in $doc.entries) { if (-not $names.Add([string]$entry.path)) { throw 'E_NTFS_MAIN_DUPLICATE' } }
    foreach ($p in $required.Paths) { if (-not $names.Contains($p)) { throw 'E_NTFS_COVERAGE' } }
    return @{ Required=$required.Count; Present=$required.Count; Covered=$true }
}
function Get-BackupNtfsRecords([string] $Root,[switch] $HashStreams) {
    $Root=Assert-BackupAbsolute $Root
    $tree=Get-NtfsTree $Root
    if ($tree.Errors.Count) { throw 'E_NTFS_ENUMERATION' }
    $entries=@()
    foreach ($row in @($tree.Rows | Sort-Object -CaseSensitive Relative)) {
        # Ordinary DAT attributes only. Unsupported NTFS attributes fail rather than disappear.
        if ($row.Attributes -band (-bnot (1 -bor 2 -bor 4 -bor 16 -bor 32 -bor 128 -bor 8192))) { throw 'E_NTFS_UNSUPPORTED_ATTRIBUTES' }
        $item=Get-Item -Force -LiteralPath $row.FullName
        $streams=@()
        foreach ($stream in @($row.Streams | Sort-Object -CaseSensitive Name)) {
            if ($stream.Name -ceq '::$DATA') { continue }
            if (-not $stream.Name.StartsWith(':') -or -not $stream.Name.EndsWith(':$DATA',[StringComparison]::Ordinal) -or $stream.Bytes -lt 0) { throw 'E_NTFS_STREAM_NAME' }
            $name=$stream.Name.Substring(1,$stream.Name.Length-7)
            if (-not $name -or $name -match '[\\/:\x00-\x1f\x7f]') { throw 'E_NTFS_STREAM_NAME' }
            $entry=[ordered]@{ Name=$name; Bytes=[long]$stream.Bytes }
            if ($HashStreams) {
                try { $h=[CarteBackup.StreamIO]::Hash(($row.FullName + ':' + $name),$stream.Bytes) }
                catch { throw 'E_NTFS_STREAM_READ_OR_CHANGED' }
                $entry.Sha256=$h.Sha256; $entry.Identity=$h.Identity
            }
            $streams+=$entry
        }
        $entries+=[ordered]@{ Path=$row.Relative; Directory=$row.Directory; Attributes=$row.Attributes; CreationUtc=[string]$item.CreationTimeUtc.Ticks; ModifiedUtc=[string]$item.LastWriteTimeUtc.Ticks; MainBytes=$(if ($row.Directory) { [long]0 } else { [long]$item.Length }); Streams=$streams }
    }
    return ,$entries
}
function Get-BackupNtfsPlan([string] $Root) {
    $nodes=Get-BackupNtfsRecords $Root
    $bytes=[long]0; $count=0
    foreach ($n in $nodes) { foreach ($s in $n.Streams) { $bytes+=$s.Bytes; $count++ } }
    return @{ Nodes=$nodes.Count; AdditionalStreams=$count; AdditionalBytes=$bytes; ContentsRead=$false }
}
function New-BackupNtfsManifest([string] $Root,[string] $MainManifest,[string] $Output,[scriptblock] $BeforeFinalRead) {
    $Root=(Assert-BackupAbsolute $Root).TrimEnd('\')
    $MainManifest=Assert-BackupAbsolute $MainManifest; $Output=Assert-BackupAbsolute $Output
    foreach ($p in @($MainManifest,$Output)) { if ($p.Equals($Root,[StringComparison]::OrdinalIgnoreCase) -or $p.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'E_NTFS_CONTROL_INSIDE_SOURCE' } }
    if ([IO.File]::Exists($Output) -or [IO.Directory]::Exists($Output)) { throw 'E_NTFS_OUTPUT_EXISTS' }
    Assert-BackupPrivate ([IO.Path]::GetDirectoryName($Output))
    $main=Read-BackupMain $MainManifest
    $mainSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $MainManifest).Hash.ToLowerInvariant()
    $nodes=Get-BackupNtfsRecords $Root -HashStreams
    $expected=@('')+@($main.directories)+@($main.entries | ForEach-Object { $_.path })
    $actual=@($nodes | ForEach-Object { $_.Path })
    if ((($expected | Sort-Object -CaseSensitive) -join "`n") -cne (($actual | Sort-Object -CaseSensitive) -join "`n")) { throw 'E_NTFS_MAIN_TREE_MISMATCH' }
    if ($BeforeFinalRead) { & $BeforeFinalRead } # Library-only deterministic synthetic race injection; never a CLI option.
    $again=Get-BackupNtfsRecords $Root -HashStreams
    if ((ConvertTo-Json -InputObject $nodes -Depth 8 -Compress) -cne (ConvertTo-Json -InputObject $again -Depth 8 -Compress)) { throw 'E_NTFS_SOURCE_CHANGED' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $MainManifest).Hash.ToLowerInvariant() -cne $mainSha) { throw 'E_NTFS_MAIN_CHANGED' }
    $doc=[ordered]@{ Format='cartehesta-ntfs-1'; MainManifestSha256=$mainSha; Nodes=$nodes }
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $doc -Depth 10)+"`n")
    $file=[IO.File]::Open($Output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
    return @{ Nodes=$nodes.Count; AdditionalStreams=@($nodes | ForEach-Object { $_.Streams } | ForEach-Object { $_ }).Count; ManifestSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash.ToLowerInvariant() }
}
function Read-BackupNtfs([string] $Path,[string] $MainManifest) {
    $doc=Get-Content -Raw -Encoding UTF8 -LiteralPath (Assert-BackupAbsolute $Path) | ConvertFrom-Json
    $main=Read-BackupMain $MainManifest
    if ($doc.Format -cne 'cartehesta-ntfs-1' -or $doc.Nodes -isnot [array] -or -not $doc.Nodes.Count -or $doc.MainManifestSha256 -cne (Get-FileHash -Algorithm SHA256 -LiteralPath $MainManifest).Hash.ToLowerInvariant()) { throw 'E_NTFS_MANIFEST_BINDING' }
    $names=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($n in $doc.Nodes) {
        if ($n.Path -isnot [string] -or $n.Path -match '[\\:\x00-\x1f\x7f]' -or $n.Path.StartsWith('/') -or ($n.Path -and @($n.Path.Split('/') | Where-Object { $_ -in @('','.','..') }).Count) -or -not $names.Add($n.Path) -or $n.Directory -isnot [bool] -or $n.Streams -isnot [array] -or $n.MainBytes -lt 0 -or $n.CreationUtc -notmatch '^\d+$' -or $n.ModifiedUtc -notmatch '^\d+$') { throw 'E_NTFS_MANIFEST_FORMAT' }
        $streams=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($s in $n.Streams) {
            if ($s.Name -isnot [string] -or -not $s.Name -or $s.Name -match '[\\/:\x00-\x1f\x7f]' -or -not $streams.Add($s.Name) -or $null -eq $s.Bytes -or $s.Bytes -lt 0 -or $s.Sha256 -cnotmatch '^[a-f0-9]{64}$' -or $s.Identity -notmatch '^\d+:\d+:\d+$') { throw 'E_NTFS_MANIFEST_FORMAT' }
        }
    }
    $expected=@('')+@($main.directories)+@($main.entries | ForEach-Object { $_.path })
    if ((($expected | Sort-Object -CaseSensitive) -join "`n") -cne ((@($doc.Nodes | ForEach-Object { $_.Path }) | Sort-Object -CaseSensitive) -join "`n")) { throw 'E_NTFS_MAIN_TREE_MISMATCH' }
    return $doc
}
function Compare-BackupNtfs([string] $First,[string] $FirstMain,[string] $Second,[string] $SecondMain,[switch] $SourceState) {
    $a=Read-BackupNtfs $First $FirstMain; $b=Read-BackupNtfs $Second $SecondMain
    function View($doc) {
        $view=@()
        foreach ($n in @($doc.Nodes | Sort-Object -CaseSensitive Path)) {
            $ss=@()
            foreach ($s in @($n.Streams | Sort-Object -CaseSensitive Name)) {
                $entry=[ordered]@{ Name=$s.Name; Bytes=$s.Bytes; Sha256=$s.Sha256 }
                if ($SourceState) { $entry.Identity=$s.Identity }
                $ss+=$entry
            }
            $view+=[ordered]@{ Path=$n.Path; Directory=$n.Directory; Attributes=$n.Attributes; CreationUtc=$n.CreationUtc; ModifiedUtc=$n.ModifiedUtc; MainBytes=$n.MainBytes; Streams=$ss }
        }
        return ConvertTo-Json -InputObject $view -Depth 8 -Compress
    }
    if ((View $a) -cne (View $b)) { throw 'E_NTFS_MANIFEST_MISMATCH' }
    return @{ Matched=$true; Nodes=$a.Nodes.Count; SourceStateCompared=[bool]$SourceState }
}
if (-not $isNtfsLibrary) {
    try {
        if ($env:NODE_OPTIONS -or $env:NODE_PATH) { throw 'E_NTFS_NODE_PRELOAD' }
        $result=switch ($Command) {
            'plan' { Get-BackupNtfsPlan $Root }
            'manifest' { New-BackupNtfsManifest $Root $MainManifest $Output }
            'compare' { Compare-BackupNtfs $Output $MainManifest $Other $OtherMainManifest -SourceState:$SourceState }
            'coverage' { Assert-BackupCoverage $MainManifest $RequiredFile $ExpectedCount }
            'private-tree' { Assert-BackupPrivateTree $Root }
            default { throw 'E_NTFS_USAGE' }
        }
        $result | ConvertTo-Json -Depth 4
    } catch {
        $code=$_.Exception.Message
        if ($code -notmatch '^E_NTFS_[A-Z_]+$') { $code='E_NTFS_OPERATION_FAILED' }
        Write-Output $code; exit 1
    }
}
