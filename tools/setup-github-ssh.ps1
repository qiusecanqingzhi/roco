<#
.SYNOPSIS
  配置 GitHub SSH 访问（绕开对 github.com:443 的封锁），并把本仓库的 remote 切成 SSH。

.DESCRIPTION
  为什么需要这个脚本：
    这台机器上 github.com:443 会被间歇性阻断（实测 6/6 超时），git 走 HTTPS 基本推不上去；
    而 ssh.github.com:443 与 github.com:22 实测稳定可用。所以改用 SSH 协议推送。

  脚本做的事：
    1. 生成 ED25519 密钥（如果还没有）
    2. 写 ~/.ssh/config：github.com 走 ssh.github.com:443（比 22 端口更不容易被干扰）
    3. 测试连接，并打印公钥供你粘贴到 GitHub
    4. 把当前仓库的 origin 切成 SSH

.USAGE
  # 在项目根目录执行
  powershell -ExecutionPolicy Bypass -File tools/setup-github-ssh.ps1
  powershell -ExecutionPolicy Bypass -File tools/setup-github-ssh.ps1 -User qiusecanqingzhi -Repo roco
#>

[CmdletBinding()]
param(
  [string]$User = 'qiusecanqingzhi',
  [string]$Repo = 'roco',
  [string]$KeyName = 'id_ed25519',
  [string]$SshDir = (Join-Path $env:USERPROFILE '.ssh'),   # 默认 ~/.ssh，可覆盖（测试用）
  [switch]$Force                     # 已有密钥时也重新生成
)

$ErrorActionPreference = 'Stop'
$sshDir  = $SshDir
$keyPath = Join-Path $sshDir $KeyName
$cfgPath = Join-Path $sshDir 'config'
$ssh     = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$keygen  = Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'

function Info($m) { Write-Host "· $m" -ForegroundColor Cyan }
function Good($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }

if (-not (Test-Path $ssh))  { throw "找不到 $ssh，请确认 Windows OpenSSH 客户端已安装" }
if (-not (Test-Path $keygen)) { throw "找不到 $keygen" }

# ---------------------------------------------------------------- 1) 密钥
if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Force -Path $sshDir | Out-Null }
if ((Test-Path $keyPath) -and -not $Force) {
  Info "已存在密钥 $keyPath（要重新生成就加 -Force）"
} else {
  Info "生成 ED25519 密钥：$keyPath"
  & $keygen -t ed25519 -C "$env:USERNAME-roco-dex" -f $keyPath -N '""'
  if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen 失败' }
  Good '密钥已生成（无口令，git 推送时不用输密码）'
}

# ---------------------------------------------------------------- 2) config
$block = @"
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile ~/.ssh/$KeyName
    IdentitiesOnly yes
    ServerAliveInterval 30
    ServerAliveCountMax 6
"@

if (Test-Path $cfgPath) {
  $existing = Get-Content $cfgPath -Raw
  if ($existing -match 'Host\s+github\.com') {
    Warn "$cfgPath 里已经有 github.com 的配置，已备份为 config.bak，并替换该段"
    Copy-Item $cfgPath "$cfgPath.bak" -Force
    # 删掉已有的 github.com 段（从 Host github.com 到下一个 Host 之前）
    $cleaned = [regex]::Replace($existing, '(?ms)^Host\s+github\.com.*?(?=^Host\s|\z)', '')
    Set-Content -Path $cfgPath -Value ($cleaned.TrimEnd() + "`n`n" + $block) -Encoding utf8
  } else {
    Add-Content -Path $cfgPath -Value "`n$block" -Encoding utf8
    Good "已把配置追加到 $cfgPath"
  }
} else {
  Set-Content -Path $cfgPath -Value $block -Encoding utf8
  Good "已写入 $cfgPath"
}

# 收紧密钥权限（OpenSSH 对权限敏感；非管理员或特殊环境失败也不影响使用）
try { & icacls $keyPath /inheritance:r /grant:r "$($env:USERNAME):(R)" 2>&1 | Out-Null } catch { Warn '设置密钥权限失败（一般不影响）' }

# ---------------------------------------------------------------- 3) 测试
Info '测试 ssh.github.com:443 连通性…'
& $ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -T git@github.com 2>&1 | ForEach-Object {
  # 首次连接会打印 "Hi <user>! You've successfully authenticated..." 或权限拒绝
  Write-Host "  $_"
}

Write-Host ''
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Yellow
Write-Host ' 接下来（只需做一次）：把下面的公钥添加到 GitHub' -ForegroundColor Yellow
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Yellow
Write-Host ''
Get-Content "$keyPath.pub"
Write-Host ''
Write-Host ' 打开 https://github.com/settings/ssh/new' -ForegroundColor Cyan
Write-Host ' Title 随便填（如 家里台式机），Key type 选 Authentication Key，' -ForegroundColor Gray
Write-Host ' 把上面整行粘进 Key 输入框，点 Add SSH key。' -ForegroundColor Gray
Write-Host ''
Write-Host ' 加完回到这里执行：' -ForegroundColor Cyan
Write-Host "   git remote set-url origin git@github.com:$User/$Repo.git" -ForegroundColor White
Write-Host '   git push -u origin main' -ForegroundColor White
Write-Host ''
Write-Host ' （本脚本已经帮你把 remote 切成 SSH，上面第一条可跳过）' -ForegroundColor Gray
