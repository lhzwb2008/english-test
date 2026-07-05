# 阿里云服务器部署（Qwen-Omni 口语批改代理）

一键安装/部署脚本：缺依赖（Node.js ≥ 18、pm2）会自动安装；已具备依赖时跳过安装，直接完成 `npm install` + `pm2` 启动/重启。脚本**幂等**，可反复执行。

## 首次部署

```bash
# 1. 把代码放到服务器（任选其一）
git clone <你的仓库地址> /opt/qwen-oral-proxy
cd /opt/qwen-oral-proxy
# 或者：直接 scp/rsync 整个仓库目录到服务器

# 2. 一键安装 + 部署
bash deploy/deploy.sh
```

脚本会自动完成：

1. 识别系统包管理器（`apt` / `dnf` / `yum`），缺 Node.js（或版本 < 18）时通过 NodeSource 安装。
2. 缺 `pm2` 时全局安装。
3. `.env` 不存在时从 `.env.example` 生成（**首次部署后需手动编辑填入真实的 `DASHSCOPE_API_KEY` 与 `QWEN_PROXY_TOKEN`**，见下）。
4. `npm ci`（有 lockfile）或 `npm install` 安装生产依赖。
5. 用 `deploy/ecosystem.config.cjs` 通过 `pm2` 启动（已存在同名进程则 `pm2 restart`）。
6. 尝试配置 `pm2 startup`（开机自启），可用 `SKIP_PM2_STARTUP=1` 跳过。
7. 请求 `/health` 做健康检查。

### 首次部署后必做：配置密钥

```bash
vi .env
# 填入：
#   DASHSCOPE_API_KEY=sk-xxx        （阿里云百炼 API Key）
#   QWEN_PROXY_TOKEN=<自定义强随机口令，业务侧调用时作为 Bearer token>

pm2 restart qwen-oral-proxy --update-env
```

## 更新部署（后续每次改动代码后）

```bash
bash deploy/update.sh          # 默认拉取 main 分支
bash deploy/update.sh release  # 或指定分支
```

等价于 `git pull` + 重跑 `deploy/deploy.sh`。

## 常用运维命令

```bash
pm2 status                     # 查看进程状态
pm2 logs qwen-oral-proxy       # 查看日志（server/index.mjs 的 console 输出）
pm2 restart qwen-oral-proxy    # 重启
pm2 stop qwen-oral-proxy       # 停止
```

## 环境变量（`.env`，参考 `.env.example`）

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key（必填，音频请求依赖） |
| `QWEN_PROXY_TOKEN` | 本代理的鉴权口令；业务侧 `CozeAPI({ token })` 填此值 |
| `QWEN_PROXY_PORT` | 监听端口，默认 `8787` |
| `QWEN_ORAL_MODEL` / `QWEN_UNIVERSAL_MODEL` | 使用的 Qwen-Omni 模型，默认 `qwen3.5-omni-flash` |
| `QWEN_FILE_TTL_MS` | 上传文件在内存中的保留时长（毫秒），默认 1 小时 |

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
