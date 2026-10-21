param([string] $Source, [switch] $LibraryOnly)
# Read-only metadata enumeration. No stream contents, copying, ACL changes or deletion.
$ErrorActionPreference = 'Stop'
if (-not ('CarteNtfs.Streams' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace CarteNtfs {
    public sealed class Row { public string Name; public long Bytes; }
    public static class Streams {
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
        private struct Data {
            public long Size;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst=296)] public string Name;
        }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern IntPtr FindFirstStreamW(string path, int level, out Data data, uint flags);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindNextStreamW(IntPtr handle, out Data data);
        [DllImport("kernel32.dll", SetLastError=true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindClose(IntPtr handle);
        public static Row[] Read(string path) {
            Data data;
            IntPtr handle=FindFirstStreamW(path, 0, out data, 0);
            if(handle == new IntPtr(-1)) {
                int error=Marshal.GetLastWin32Error();
                if(error==38) return new Row[0]; // No streams, e.g. ordinary directory.
                throw new Win32Exception(error);
            }
            var result=new List<Row>();
            try {
                do { result.Add(new Row { Name=data.Name, Bytes=data.Size }); }
                while(FindNextStreamW(handle, out data));
                int error=Marshal.GetLastWin32Error();
                if(error!=38) throw new Win32Exception(error);
            } finally { FindClose(handle); }
            return result.ToArray();
        }
    }
}
'@
}
function Get-NtfsCategory([string] $Relative) {
    switch -Regex ($Relative.Replace('\','/')) {
        '^\.git(?:/|$)' { return 'Git-metadata-and-objects' }
        '^node_modules(?:/|$)' { return 'Dependencies' }
        '^(?:test-results|playwright-report)(?:/|$)' { return 'Diagnostics' }
        '^assets(?:/|$)' { return 'Assets' }
        '^(?:server|js|tools|ops)(?:/|$)' { return 'Application-and-tools' }
        '^tests(?:/|$)' { return 'Tests' }
        '^docs(?:/|$)' { return 'Documentation' }
        default { return 'Root-and-other' }
    }
}
function Get-NtfsTree([string] $Root) {
    if (-not [IO.Path]::IsPathRooted($Root)) { throw 'E_NTFS_ABSOLUTE_ROOT' }
    $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $cursor = $Root
    while ($cursor) {
        if ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) { throw 'E_NTFS_REPARSE_ANCESTOR' }
        $parent = [IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor = $parent.FullName
    }
    $rows = [Collections.Generic.List[object]]::new()
    $errorsFound = [Collections.Generic.List[object]]::new()
    $pending = [Collections.Generic.Stack[IO.FileSystemInfo]]::new()
    $pending.Push([IO.DirectoryInfo]::new($Root))
    while ($pending.Count) {
        $item = $pending.Pop()
        $relative = $item.FullName.Substring($Root.Length).TrimStart('\').Replace('\','/')
        $category = Get-NtfsCategory $relative
        $operation = 'attributes'
        try {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'E_NTFS_REPARSE_SKIPPED' }
            $directory = [bool]($item.Attributes -band [IO.FileAttributes]::Directory)
            $operation = 'streams'
            $streams = @([CarteNtfs.Streams]::Read($item.FullName))
            $rows.Add([pscustomobject]@{ Relative=$relative; FullName=$item.FullName; Category=$category; Directory=$directory; Attributes=[int]$item.Attributes; Streams=$streams })
            if ($directory) {
                $operation = 'directory-enumeration'
                foreach ($child in $item.GetFileSystemInfos()) { $pending.Push($child) }
            }
        } catch {
            $ex = $_.Exception
            while ($ex.InnerException) { $ex = $ex.InnerException }
            $code = if ($ex -is [ComponentModel.Win32Exception]) { $ex.NativeErrorCode } else { $ex.GetType().FullName }
            $errorsFound.Add([pscustomobject]@{ Category=$category; Operation=$operation; Code=$code })
        }
    }
    return @{ Rows=$rows; Errors=$errorsFound }
}
function Get-NtfsSummary($Tree) {
    $summary = [ordered]@{ FilesEnumerated=0; DirectoriesEnumerated=0; FilesWithAdditionalStreams=0; DirectoriesWithAdditionalStreams=0; AdditionalStreams=0; AdditionalBytes=[long]0; StandardUnnamedStreams=0; Types=@{}; Categories=@{}; EnumerationErrors=@($Tree.Errors); StreamContentsRead=$false }
    foreach ($row in $Tree.Rows) {
        if ($row.Directory) { $summary.DirectoriesEnumerated++ } else { $summary.FilesEnumerated++ }
        if (-not $summary.Categories.ContainsKey($row.Category)) { $summary.Categories[$row.Category]=@{ Files=0; Directories=0; AffectedFiles=0; AffectedDirectories=0; Streams=0; Bytes=[long]0 } }
        $cat=$summary.Categories[$row.Category]
        if ($row.Directory) { $cat.Directories++ } else { $cat.Files++ }
        $affected=$false
        foreach ($stream in $row.Streams) {
            if ($stream.Name -ceq '::$DATA') { $summary.StandardUnnamedStreams++; continue }
            $affected=$true
            # Raw stream names can contain personal information: publish only safe types.
            $type = if ($stream.Name -ieq ':Zone.Identifier:$DATA') { 'Zone.Identifier ($DATA)' } elseif ($stream.Name.EndsWith(':$DATA',[StringComparison]::OrdinalIgnoreCase)) { 'Other-named-$DATA' } else { 'Other-stream-type' }
            if (-not $summary.Types.ContainsKey($type)) { $summary.Types[$type]=@{ Streams=0; Bytes=[long]0 } }
            $summary.Types[$type].Streams++; $summary.Types[$type].Bytes += $stream.Bytes
            $summary.AdditionalStreams++; $summary.AdditionalBytes += $stream.Bytes
            $cat.Streams++; $cat.Bytes += $stream.Bytes
        }
        if ($affected) {
            if ($row.Directory) { $summary.DirectoriesWithAdditionalStreams++; $cat.AffectedDirectories++ }
            else { $summary.FilesWithAdditionalStreams++; $cat.AffectedFiles++ }
        }
    }
    return $summary
}
if (-not $LibraryOnly) {
    try {
        $tree = Get-NtfsTree $Source
        Get-NtfsSummary $tree | ConvertTo-Json -Depth 7
        if ($tree.Errors.Count) { exit 1 }
    } catch { Write-Output '{"DiagnosticFailed":true,"PrivatePathsAndContentsSuppressed":true}'; exit 1 }
}
