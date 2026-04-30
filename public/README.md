# 隐患排查管理系统 - 部署说明

## 快速部署到 Vercel（推荐）

### 方法一：拖拽部署（最简单）

1. 打开 https://vercel.com/new
2. 登录您的账号（可用 GitHub/GitLab/Bitbucket 或邮箱注册）
3. 将 `dist` 文件夹直接拖拽到页面上
4. 点击 "Deploy" 等待部署完成
5. 部署成功后会获得一个永久网址，如：`https://hazard-admin-xxx.vercel.app`

### 方法二：CLI 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 进入 dist 目录
cd dist

# 部署
vercel --prod
```

---

## 后端部署

前端部署后，您还需要部署后端 API。推荐以下方式：

### 方案一：部署到 Vercel Serverless

1. 创建 `api` 目录，将后端代码改造为 Serverless 函数
2. 与前端一起部署

### 方案二：部署到云服务器

将 `server` 目录上传到您的云服务器（阿里云、腾讯云等），然后：

```bash
cd server
npm install
npm start
```

### 方案三：使用 Railway/Render（免费）

1. 打开 https://railway.app 或 https://render.com
2. 连接 GitHub 仓库或直接上传
3. 自动部署

---

## 配置后端地址

部署完成后，需要修改前端的后端 API 地址。

### 如果前后端都在 Vercel：

在 `vercel.json` 中修改：
```json
"destination": "https://您的后端地址.vercel.app/api/$1"
```

### 如果后端在其他服务器：

修改 `assets/*.js` 文件中的 API 地址，或在浏览器控制台设置：
```javascript
localStorage.setItem('api_base', 'https://您的后端地址')
```

---

## 默认管理员账号

- 用户名：`admin`
- 密码：`admin123`

⚠️ **部署后请立即修改默认密码！**

---

## 功能说明

- 📊 数据概览 - 统计卡片、图表展示
- ⚠️ 隐患管理 - 查看、处理隐患上报
- 👥 用户管理 - 添加、编辑、删除用户
- 📂 分类管理 - 隐患分类管理
- 📋 隐患类型 - 含法规依据的类型管理
