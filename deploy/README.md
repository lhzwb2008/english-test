# 阿里云服务器部署（Qwen-Omni 口语批改代理）

一键安装/部署脚本：缺依赖（Node.js ≥ 18、pm2）会自动安装；已具备依赖时跳过安装，直接完成 `npm install` + `pm2` 启动/重启。脚本**幂等**，可反复执行。

## 首次部署

**当前生产环境**（`101.201.237.149`）首次是用 **rsync 从本机同步代码** 到 `/opt/qwen-oral-proxy`，再执行 `bash deploy/deploy.sh`，**不是** `git clone`。

后续推荐改为 git 管理，便于 `git pull` 更新：

```bash
# 方式 A（推荐）：服务器上 clone 新目录（首次或重建时）
git clone https://github.com/lhzwb2008/english-test.git /opt/qwen-oral-proxy
cd /opt/qwen-oral-proxy
cp .env.example .env && vi .env   # 填入 DASHSCOPE_API_KEY、QWEN_PROXY_PORT=8000
bash deploy/deploy.sh

# 方式 B：已有 rsync 目录时，在服务器 init git（保留现有 .env）
cd /opt/qwen-oral-proxy
cp .env /root/qwen-oral-proxy.env.bak
git init && git remote add origin https://github.com/lhzwb2008/english-test.git
git fetch origin main && git checkout -f -B main origin/main
cp /root/qwen-oral-proxy.env.bak .env
bash deploy/deploy.sh
```

```bash
# 方式 C：本机 rsync 同步（不依赖 GitHub，首次实际使用的方式）
rsync -az --exclude node_modules --exclude .git ./ root@101.201.237.149:/opt/qwen-oral-proxy/
ssh root@101.201.237.149 "cd /opt/qwen-oral-proxy && bash deploy/deploy.sh"
```

脚本会自动完成：

1. 识别系统包管理器（`apt` / `dnf` / `yum`），缺 Node.js（或版本 < 18）时通过 NodeSource 安装。
2. 缺 `pm2` 时全局安装。
3. `.env` 不存在时从 `.env.example` 生成（**首次部署后需手动编辑填入真实的 `DASHSCOPE_API_KEY`**，见下）。
4. `npm ci`（有 lockfile）或 `npm install` 安装生产依赖。
5. 用 `deploy/ecosystem.config.cjs` 通过 `pm2` 启动（已存在同名进程则 `pm2 restart`）。
6. 尝试配置 `pm2 startup`（开机自启），可用 `SKIP_PM2_STARTUP=1` 跳过。
7. 请求 `/health` 做健康检查。

### 首次部署后必做：配置密钥

```bash
vi .env
# 填入：
#   DASHSCOPE_API_KEY=sk-xxx        （阿里云百炼 API Key，仅服务端持有，不对外暴露）

pm2 restart qwen-oral-proxy --update-env
```

> **鉴权说明**：本代理不要求业务侧传任何 token（区别于 Coze 的 `COZE_API_TOKEN`）。安全性由服务器网络侧保障（安全组/内网限制来源 IP，或在 Nginx 层加白名单），业务侧直接调用即可，`CozeAPI({ token })` 传任意占位字符串（SDK 要求非空）都可以。

## 更新部署（后续每次改动代码后）

**前提**：代码已 `git push` 到 `origin/main`（`https://github.com/lhzwb2008/english-test.git`）。

在服务器上：

```bash
cd /opt/qwen-oral-proxy
bash deploy/update.sh          # 默认拉取 main 分支
bash deploy/update.sh release  # 或指定分支
```

等价于 `git pull` + 重跑 `deploy/deploy.sh`（`npm ci` + `pm2 restart`）。**`.env` 不会被 git 覆盖**，改密钥后需 `pm2 restart qwen-oral-proxy --update-env`。

若服务器尚未 init git（仍是纯 rsync 目录），请先用上文「方式 B」绑定远程，或继续用 rsync + `deploy.sh`。

## 常用运维命令

```bash
pm2 status                     # 查看进程状态
pm2 logs qwen-oral-proxy       # 查看日志（server/index.mjs 的 console 输出）
pm2 restart qwen-oral-proxy    # 重启
pm2 stop qwen-oral-proxy       # 停止

# 业务请求 JSONL + 抽样媒体（每天最多 10 份完整图片/音频，最多保留 7 天）
ls /opt/qwen-oral-proxy/server/data/request-logs/
tail -n 5 /opt/qwen-oral-proxy/server/data/request-logs/$(date +%F).jsonl
ls /opt/qwen-oral-proxy/server/data/request-logs/media/$(date +%F)/ 2>/dev/null | head
```

请求日志默认开启。文本入参/出参都会记（脱敏、截断）。**图片和音频每天最多保存 10 份完整文件**到 `media/日期/`，超出名额的只记文件名和大小，方便复现又不撑爆磁盘。启动和写入时自动删除超过 **7 天** 的 JSONL 与媒体。

## 环境变量（`.env`，参考 `.env.example`）

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key（必填，音频请求依赖；仅服务端持有） |
| `QWEN_PROXY_PORT` | 监听端口，默认 `8787` |
| `QWEN_ORAL_MODEL` / `QWEN_UNIVERSAL_MODEL` | 使用的 Qwen-Omni 模型，默认 `qwen3.5-omni-flash` |
| `QWEN_TEXT_MODEL` | 语法总评 / 讲解 / 口播分镜文本模型，默认 `qwen3.8-max` |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 口播成片上传正式 OSS |
| `OSS_BUCKET` / `OSS_PREFIX` | 默认 `nba-dev-sh` / `wenbo` |
| `OSS_ENDPOINT` / `OSS_REGION` | 上海：`oss-cn-shanghai.aliyuncs.com` |
| `OSS_URL_MODE` | `signed`（私有桶默认）或 `public` |
| `OSS_SIGNED_URL_SECONDS` | 签名有效期，默认 7 天；查询接口会刷新签名 |
| `REQUEST_LOG_ENABLED` | 业务请求落盘，默认 `1`；`0` 关闭 |
| `REQUEST_LOG_DIR` | JSONL 目录，默认 `server/data/request-logs` |
| `REQUEST_LOG_RETENTION_DAYS` | 最多保留天数，默认 **7**（上限 7） |
| `REQUEST_LOG_MAX_MEDIA_PER_DAY` | 每天完整保存的图片/音频请求数，默认 **10** |

错题讲解视频接口依赖本机 **ffmpeg**（及中文字体）；`deploy/deploy.sh` 会尝试自动安装。

## 建议：Nginx 反向代理 + HTTPS

生产环境建议在前面挂 Nginx 做 TLS 终结与反代（业务侧走 HTTPS，符合前端调用习惯），示例：

```nginx
server {
    listen 443 ssl http2;
    server_name qwen-proxy.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/qwen-proxy.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/qwen-proxy.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;      # SSE 必须关闭缓冲
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

`proxy_buffering off` 对 `/v3/chat` 的 SSE 流式响应是**必需**的，否则 Nginx 会缓冲整段响应，前端收不到增量事件。

## 防火墙 / 安全组

阿里云控制台安全组需放通：

- 若直连代理端口：`TCP 8787`（仅限内网/白名单来源，不建议公网直开）。
- 若走 Nginx：放通 `TCP 443`（HTTPS），代理端口 `8787` 仅本机 `127.0.0.1` 监听即可（无需公网放通）。
