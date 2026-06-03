# 猫咪追鼠

一个可直接部署到 GitHub Pages 的静态 PWA 小游戏，优先适配 iPad Safari 和 iPad 主屏幕打开体验。

## 当前玩法

- 画面中只有一只蓝色卡通小老鼠，身体更大、眼睛更夸张、没有胡须。
- 小老鼠的尾巴非常长，会持续形成不规则的上下弯曲波动。
- 小老鼠会在长距离路线中移动，路线会随机选择直线或曲线。
- 运动阶段包含短跑、普通跑、警觉停顿和短暂停顿，不再一直匀速移动。
- 跑动时会持续播放原创合成的细碎塑料袋窸窣声、纸箱轻刮声和小脚步声。
- 触碰小老鼠后会播放短促反馈音，小老鼠消失并快速重生。
- 长按右上角隐藏区域 2 秒可打开主人设置，调节音量和速度。

## iPad 使用建议

1. 用 Safari 打开公网链接。
2. 点一次“开始”，用于解锁 iPad Safari 的声音限制。
3. 可选择“分享 -> 添加到主屏幕”，以 PWA 方式打开。
4. 建议开启 iPad 的“引导式访问”，锁定当前页面，避免猫咪误触退出。

网页可以请求全屏、横屏和屏幕唤醒，但 iOS 不允许网页真正锁住系统按键或阻止 Safari 被退出。退出或切到后台后，页面会尽量在返回时恢复游戏；如果系统要求重新授权声音，点“继续”即可。

## 本地预览

```powershell
powershell -ExecutionPolicy Bypass -File .\dev-server.ps1
```

然后打开：

```text
http://127.0.0.1:4173/
```

## 公网部署

本项目无需构建，直接通过 GitHub Pages 发布仓库根目录即可。当前仓库已配置 `.github/workflows/pages.yml`，推送到 `main` 后会自动发布。

稳定链接：

```text
https://dawnoom.github.io/cat-mouse-game/
```

## 文件说明

- `index.html`：网页入口和 PWA 元信息。
- `styles.css`：全屏布局、开始按钮和隐藏设置面板样式。
- `src/game.js`：Canvas 游戏循环、老鼠运动、触摸命中、音效和 iPad 恢复逻辑。
- `manifest.webmanifest`：PWA 配置。
- `icons/`：主屏幕图标。
- `dev-server.ps1`：本地静态预览服务器。
