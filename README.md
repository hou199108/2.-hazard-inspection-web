# 隐患排查管理系统 - Vercel 一键部署版

## 🚀 快速部署（3分钟上线）

### 方法一：拖拽部署（推荐新手）

1. 打开 https://vercel.com/new
2. 登录或注册（支持 GitHub/邮箱）
3. 将整个 `vercel-full` 文件夹拖拽到页面
4. 点击 **Deploy**
5. 等待部署完成，获得永久网址！

### 方法二：GitHub 部署（推荐开发者）

1. 将 `vercel-full` 文件夹上传到 GitHub 仓库
2. 打开 https://vercel.com/new
3. 选择 Import Git Repository
4. 选择您的仓库，点击 Deploy

### 方法三：CLI 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 进入目录
cd vercel-full

# 部署
vercel --prod
```

---

## 📦 项目结构

```
vercel-full/
├── api/
│   └── index.js      # 后端 API（Serverless）
├── public/           # 前端静态文件
│   ├── index.html
│   ├── assets/
│   └── ...
├── package.json
└── vercel.json       # Vercel 配置
```

---

## 🔐 默认管理员账号

- 用户名：`admin`
- 密码：`admin123`

⚠️ **部署后请立即修改密码！**

---

## ✨ 功能特性

| 模块 | 功能 |
|------|------|
| 📊 数据概览 | 统计卡片、分类饼图、风险等级柱状图 |
| ⚠️ 隐患管理 | 列表查询、详情查看、处理状态更新 |
| 👥 用户管理 | 添加/编辑/删除用户、重置密码 |
| 📂 分类管理 | 隐患分类增删改查 |
| 📋 隐患类型 | 含法规依据的隐患类型管理 |

---

## ⚠️ 注意事项

### 关于数据持久化

Vercel Serverless 是无状态的，数据库存储在 `/tmp` 目录，**每次冷启动数据会重置**。

如需持久化数据，建议：
1. 使用 Vercel Postgres（推荐）
2. 使用 Supabase（免费）
3. 使用 MongoDB Atlas（免费）

如需帮助配置数据库持久化，请联系我。

---

## 🌐 部署后

部署成功后，您会获得类似这样的网址：
```
https://hazard-inspection-system-xxx.vercel.app
```

直接访问即可使用！
