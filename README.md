# 猫鼠追追

一个纯静态网页/PWA 小游戏，适合部署到 GitHub Pages、Netlify、Vercel 或任意静态网站服务。客户端用户只需要打开网页链接即可游玩，不需要安装 App。

## 当前玩法

- 画面中只有一只蓝色卡通小老鼠。
- 小老鼠会走较长路线后停顿，每次停顿 0.5-1.5 秒随机变化。
- 移动轨迹会随机选择直线或曲线。
- 碰到边界时，有时改变路线，有时继续运动直到离开屏幕，再从屏幕边缘重新出现。
- 尾巴会连续、缓慢、大幅度摆动。
- 点击“开始”后会解锁声音，并尝试进入全屏、保持屏幕唤醒和横屏。

## 小猫触屏锁定

网页无法真正锁住 iPad 的系统按钮或阻止退出 Safari，这是 iOS 的安全限制。推荐这样使用：

1. 用 Safari 打开网页。
2. 点击“开始”。
3. 可选：添加到主屏幕，以 PWA 全屏方式打开。
4. 打开 iPad 的“引导式访问”，锁定当前页面，让小猫只能触屏玩游戏。

## 本地预览

```powershell
powershell -ExecutionPolicy Bypass -File .\dev-server.ps1
```

然后打开：

```text
http://127.0.0.1:4173/
```

## iPad 同 Wi-Fi 访问

`127.0.0.1` 只能在电脑自己打开，iPad 不能用这个地址访问电脑。要让 iPad Safari 直接打开，请让 iPad 和电脑连接同一个 Wi-Fi，然后用电脑的局域网 IP 启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\dev-server.ps1 -HostAddress 10.20.103.87
```

然后在 iPad Safari 打开：

```text
http://10.20.103.87:4173/
```

如果 iPad 仍无法打开，通常是 Windows 防火墙拦截了 PowerShell 的入站连接，需要允许当前网络中的设备访问此端口。

## 部署

这个项目不需要构建，直接把整个文件夹作为静态站点发布即可。只有发布到公网后，才会得到任何客户端、任何网络都能直接打开的链接。

- GitHub Pages：上传本目录所有文件，Pages source 选择仓库根目录。
- Netlify：拖拽整个文件夹到 Netlify Drop。
- Vercel：导入项目，Framework Preset 选择 Other，输出目录留空或设为项目根目录。
- 任意静态服务器：发布 `index.html`、`styles.css`、`src/`、`icons/`、`manifest.webmanifest`。

## 当前临时公网链接

当前会话已通过临时隧道发布到：

```text
https://18ee7d0192c803.lhr.life/
```

这是临时公网链接，只有在这台电脑保持开机、当前本地服务器和 SSH 隧道都运行时有效。要获得长期稳定链接，请使用上面的 GitHub Pages、Netlify 或 Vercel 发布方式。

## 文件说明

- `index.html`：网页入口和 PWA 元信息。
- `styles.css`：全屏布局、开始按钮和隐藏设置面板样式。
- `src/game.js`：Canvas 游戏循环、老鼠运动、触摸命中、音效和全屏逻辑。
- `manifest.webmanifest`：PWA 配置。
- `icons/`：主屏幕图标。
- `dev-server.ps1`：本地静态预览服务器。
