# SHA-256 without Get-FileHash.
#
# The build script runs under Windows PowerShell 5.1. GitHub Actions
# sets PSModuleAutoLoadingPreference=None, and Get-FileHash lives in a
# module, so the cmdlet is not available there. The .NET API has no
# module dependency and returns the same lowercase hex on 5.1 and 7.
function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash($stream)
            return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}
