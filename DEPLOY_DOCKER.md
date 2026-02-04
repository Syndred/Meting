# Docker 部署说明 (宝塔面板适用)

以下步骤适用于你在 GitHub 上已经合并 `master`（包含 Dockerfile 和 GitHub Actions）的仓库，并使用宝塔面板的容器/镜像管理来部署。

## 镜像来源
- 我们在仓库中添加了 GitHub Actions workflow，会在推送到 `master` 时构建并将镜像发布到 GitHub Container Registry (GHCR)。镜像名称格式：
  - ghcr.io/<你的 GitHub 用户名>/meting-api:latest

> 如果 Actions 未启用或尚未完成首次构建，也可以手动在服务器上用 `docker build -t meting-api:latest .` 构建镜像。

## 在宝塔面板使用“镜像管理”拉取镜像并运行
1. 打开 宝塔 → 软件商店 → 容器管理（或左侧“容器”）→ 镜像管理 → 拉取镜像。
2. 镜像名称填写：`ghcr.io/Syndred/meting-api:latest`（替换为你的 GHCR 用户名）。
   - 如果镜像是私有的，需要在宝塔中配置 GHCR 的用户名和 token（作为镜像仓库认证）。
3. 拉取完成后，点击“创建容器”并配置：
   - 端口映射：宿主端口 3200 -> 容器端口 3000（或按需调整）。
   - 环境变量：`PORT=3000`（容器内部使用）。
   - 重启策略：选择 `unless-stopped` 或 `always`。
4. 启动容器，检查容器日志是否有类似：`[meting-api] listening on http://0.0.0.0:3000`。

## 使用 docker-compose（如果宝塔支持）
- 直接把仓库里的 `docker-compose.yml` 上传到服务器对应目录，然后运行：
  - docker-compose up -d --build
- 示例 `docker-compose.yml` 已包含：端口映射 `3200:3000`、服务名 `meting`。

## 健康检查
- 访问：`http://<你的服务器IP或域名>:3200/health`，应返回：

  {
    "ok": true
  }

## 常见问题提示
- 如果 Actions 未发布镜像：可在服务器上直接 `docker pull ghcr.io/Syndred/meting-api:latest`（注意认证）；或者直接 clone 仓库并 `docker build`。
- Node 版本：镜像使用 `node:20-alpine`，推荐服务器容器支持该版本。
- 私有 GHCR 认证：在宝塔镜像拉取对话中填入用户名和 Personal Access Token（需有 read:packages 权限）。

---

需要我现在把这个文件提交并推送到 `master` 吗？（我将把它推送到你的 fork `git@github.com:Syndred/Meting.git`）
