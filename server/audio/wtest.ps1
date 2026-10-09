# Small helper for hand-testing the worker:  powershell -File wtest.ps1 sfx "a prompt" 2 [loop]
param([string]$kind, [string]$prompt, [double]$seconds = 2, [string]$loop = "false", [int]$port = 18775, [string]$extra = "")
$body = @{ prompt = $prompt; seconds = $seconds; loop = ($loop -eq "true") }
if ($extra) { $j = $extra | ConvertFrom-Json; $j.PSObject.Properties | ForEach-Object { $body[$_.Name] = $_.Value } }
$r = Invoke-RestMethod -Method Post "http://127.0.0.1:$port/$kind" -ContentType application/json -Body ($body | ConvertTo-Json -Depth 5)
$t0 = Get-Date
do { Start-Sleep -Milliseconds 700; $v = Invoke-RestMethod "http://127.0.0.1:$port/jobs/$($r.job)" } while ($v.state -ne "done" -and $v.state -ne "error")
"{0}  {1:N1}s wall" -f $v.state, ((Get-Date) - $t0).TotalSeconds
$v | ConvertTo-Json -Depth 6
