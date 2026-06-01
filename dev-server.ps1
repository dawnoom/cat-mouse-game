param(
  [int]$Port = 4173,
  [string]$HostAddress = "127.0.0.1"
)

$Root = (Resolve-Path $PSScriptRoot).Path
$IPAddress = [System.Net.IPAddress]::Parse($HostAddress)
$Listener = [System.Net.Sockets.TcpListener]::new($IPAddress, $Port)
$Types = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
}

function Send-Response($Client, [int]$StatusCode, [string]$StatusText, [string]$ContentType, [byte[]]$Body) {
  $Stream = $Client.GetStream()
  $HeaderText = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $Header = [System.Text.Encoding]::ASCII.GetBytes($HeaderText)
  $Stream.Write($Header, 0, $Header.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

$Listener.Start()
Write-Host "Serving $Root at http://$HostAddress`:$Port/"

try {
  while ($true) {
    $Client = $Listener.AcceptTcpClient()
    try {
      $Stream = $Client.GetStream()
      $Buffer = New-Object byte[] 4096
      $Read = $Stream.Read($Buffer, 0, $Buffer.Length)
      if ($Read -le 0) {
        $Client.Close()
        continue
      }

      $Request = [System.Text.Encoding]::ASCII.GetString($Buffer, 0, $Read)
      $RequestLine = ($Request -split "`r?`n")[0]
      $Parts = $RequestLine -split " "
      if ($Parts.Length -lt 2 -or $Parts[0] -ne "GET") {
        Send-Response $Client 405 "Method Not Allowed" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Method Not Allowed"))
        continue
      }

      $Path = [System.Uri]::UnescapeDataString($Parts[1].Split("?")[0]).TrimStart("/")
      if ([string]::IsNullOrWhiteSpace($Path)) {
        $Path = "index.html"
      }

      $File = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $Path))
      if (-not $File.StartsWith($Root)) {
        Send-Response $Client 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Forbidden"))
      } elseif ([System.IO.File]::Exists($File)) {
        $Ext = [System.IO.Path]::GetExtension($File).ToLowerInvariant()
        $ContentType = if ($Types.ContainsKey($Ext)) { $Types[$Ext] } else { "application/octet-stream" }
        Send-Response $Client 200 "OK" $ContentType ([System.IO.File]::ReadAllBytes($File))
      } else {
        Send-Response $Client 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Not Found"))
      }
    } finally {
      $Client.Close()
    }
  }
} finally {
  $Listener.Stop()
}
