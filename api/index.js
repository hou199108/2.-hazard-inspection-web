const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();

// ============================================================
// 🔒 安全配置
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'hazard_inspection_jwt_secret_' + uuidv4();
const JWT_EXPIRES = '7d';
const BCRYPT_SALT_ROUNDS = 10;

// 生产环境 CORS 白名单（可配置）
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['*'];

// 中间件
app.use(cors({
  origin: (origin, callback) => {
    // "*" 表示允许所有（开发模式）
    if (ALLOWED_ORIGINS[0] === '*') return callback(null, true);
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// 内存存储上传文件
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB 上限
});

// ============================================================
// 🛡️ 速率限制（防止暴力破解）
// ============================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10,                   // 最多10次尝试
  message: { success: false, message: '登录尝试次数过多，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 200,             // 最多200次请求
  message: { success: false, message: '请求频率过高，请稍后再试' },
});

// 全局限流
app.use('/api/', apiLimiter);

// ============================================================
// 🔑 JWT 鉴权中间件
// ============================================================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未登录，请先登录' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
}

function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未登录，请先登录' });
  }
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
}

// ============================================================
// 📦 数据库
// ============================================================
const dbPath = '/tmp/hazard.db';

class DatabaseWrapper {
  constructor(db) {
    this.db = db;
  }

  exec(sql) {
    this.db.run(sql);
    this.save();
  }

  prepare(sql) {
    return new StatementWrapper(this.db, sql, this);
  }

  save() {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (e) {
      // 忽略保存错误
    }
  }
}

class StatementWrapper {
  constructor(db, sql, dbWrapper) {
    this.db = db;
    this.sql = sql;
    this.dbWrapper = dbWrapper;
  }

  run(...params) {
    this.db.run(this.sql, params);
    this.dbWrapper.save();
    return { changes: this.db.getRowsModified() };
  }

  get(...params) {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  all(...params) {
    const results = [];
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
}

let dbPromise = null;

async function getDatabase() {
  if (dbPromise) return dbPromise;
  
  dbPromise = (async () => {
    const SQL = await initSqlJs();
    
    let dbInstance;
    if (fs.existsSync(dbPath)) {
      try {
        const fileBuffer = fs.readFileSync(dbPath);
        dbInstance = new SQL.Database(fileBuffer);
      } catch (e) {
        dbInstance = new SQL.Database();
      }
    } else {
      dbInstance = new SQL.Database();
    }
    
    const db = new DatabaseWrapper(dbInstance);
    
    // 创建表
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS hazard_types (
        id INTEGER PRIMARY KEY,
        category_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        risk_level TEXT DEFAULT '一般',
        regulation TEXT,
        regulation_article TEXT,
        regulation_content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      );

      CREATE TABLE IF NOT EXISTS hazards (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        category_id INTEGER,
        hazard_type_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        ai_description TEXT,
        location TEXT,
        latitude REAL,
        longitude REAL,
        images TEXT,
        status TEXT DEFAULT '待处理',
        risk_level TEXT DEFAULT '一般',
        reporter_name TEXT,
        reporter_phone TEXT,
        handler_id TEXT,
        handler_name TEXT,
        handle_result TEXT,
        handle_images TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        handled_at DATETIME,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (hazard_type_id) REFERENCES hazard_types(id)
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'user',
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ai_recognitions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        image_path TEXT,
        result TEXT,
        confidence REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 🔒 初始化管理员（密码已加盐哈希）
    const hashedPassword = await bcrypt.hash('admin123', BCRYPT_SALT_ROUNDS);
    db.prepare(`INSERT OR IGNORE INTO admins (username, password, name, role) VALUES
      ('admin', ?, '系统管理员', 'super_admin')
    `).run(hashedPassword);

    // 初始化分类数据
    db.prepare(`INSERT OR IGNORE INTO categories (id, name, icon, description, sort_order) VALUES
      (1, '消防安全', '🔥', '火灾隐患、消防设施等问题', 1),
      (2, '交通安全', '🚗', '道路、车辆、交通设施隐患', 2),
      (3, '建筑安全', '🏗️', '建筑物结构、施工安全隐患', 3),
      (4, '电气安全', '⚡', '用电、电气设备隐患', 4),
      (5, '燃气安全', '💨', '燃气管道、设备隐患', 5),
      (6, '食品安全', '🍔', '食品卫生、餐饮安全', 6),
      (7, '环境安全', '🌿', '环境污染、生态破坏', 7),
      (8, '公共设施', '🏛️', '市政设施、公共场所隐患', 8),
      (9, '特种设备', '⚙️', '电梯、锅炉等特种设备隐患', 9),
      (10, '职业健康', '😷', '职业病危害、劳动保护', 10),
      (11, '校园安全', '🏫', '学校、教育机构安全隐患', 11),
      (12, '社区安全', '🏘️', '小区、社区安全隐患', 12)
    `).run();

    // 初始化默认测试用户（手机号登录用）
    const testUserPassword = await bcrypt.hash('123456', BCRYPT_SALT_ROUNDS);
    db.prepare(`INSERT OR IGNORE INTO users (id, phone, password, name, role, status) VALUES
      ('test-001', '18509029208', ?, '测试用户', 'user', 'active')
    `).run(testUserPassword);

    // 初始化隐患类型数据（从 SQL 文件加载）
    try {
      const sqlPath = path.join(__dirname, '..', 'init_hazard_types.sql');
      if (fs.existsSync(sqlPath)) {
        const sqlContent = fs.readFileSync(sqlPath, 'utf8').trim();
        if (sqlContent) {
          const insertSQL = `INSERT OR IGNORE INTO hazard_types (id, category_id, name, description, risk_level, regulation, regulation_article, regulation_content) VALUES ${sqlContent}`;
          db.prepare(insertSQL).run();
          const count = db.prepare('SELECT COUNT(*) as count FROM hazard_types').get().count;
          console.log(`✅ 已加载 ${count} 条隐患类型数据`);
        }
      } else {
        // 如果文件不存在，直接从 gen_hazard_types_sql.txt 读取
        const fallbackPaths = [
          path.join(__dirname, '..', '..', 'gen_hazard_types_sql.txt'),
          path.join(__dirname, '..', '..', '..', 'gen_hazard_types_sql.txt'),
        ];
        for (const fp of fallbackPaths) {
          if (fs.existsSync(fp)) {
            const sqlContent = fs.readFileSync(fp, 'utf8').trim();
            if (sqlContent) {
              const insertSQL = `INSERT OR IGNORE INTO hazard_types (id, category_id, name, description, risk_level, regulation, regulation_article, regulation_content) VALUES ${sqlContent}`;
              db.prepare(insertSQL).run();
              const count = db.prepare('SELECT COUNT(*) as count FROM hazard_types').get().count;
              console.log(`✅ 已加载 ${count} 条隐患类型数据`);
            }
            break;
          }
        }
      }
    } catch (err) {
      console.error('⚠️ 隐患类型数据加载失败（首次运行可忽略）:', err.message);
    }

    return db;
  })();
  
  return dbPromise;
}

// ============================================================
// 🔒 辅助函数 - 输入清理
// ============================================================
function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function validatePhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

// ============================================================
// 🌐 API 路由
// ============================================================

// 获取所有分类
app.get('/api/categories', async (req, res) => {
  const db = await getDatabase();
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  res.json({ success: true, data: categories });
});

// 获取分类下的隐患类型
app.get('/api/categories/:id/types', async (req, res) => {
  const db = await getDatabase();
  const types = db.prepare('SELECT * FROM hazard_types WHERE category_id = ?').all(req.params.id);
  res.json({ success: true, data: types });
});

// 获取所有隐患类型
app.get('/api/hazard-types', async (req, res) => {
  const db = await getDatabase();
  const types = db.prepare(`
    SELECT ht.*, c.name as category_name 
    FROM hazard_types ht 
    LEFT JOIN categories c ON ht.category_id = c.id
  `).all();
  res.json({ success: true, data: types });
});

// ==================== 用户认证 ====================

// 🔒 用户登录（密码加盐验证 + JWT）
app.post('/api/user/login', loginLimiter, async (req, res) => {
  const { phone, password } = req.body;
  const db = await getDatabase();
  
  if (!phone || !password) {
    return res.json({ success: false, message: '请输入手机号和密码' });
  }
  
  if (!validatePhone(phone)) {
    return res.json({ success: false, message: '手机号格式不正确' });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  
  if (!user) {
    return res.json({ success: false, message: '手机号或密码错误' });
  }
  
  // ⚡ 密码验证（兼容旧哈希和新哈希）
  let passwordValid = false;
  try {
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      passwordValid = bcrypt.compareSync(password, user.password);
    } else {
      // 兼容旧明文密码，登录后自动升级为哈希
      passwordValid = user.password === password;
      if (passwordValid) {
        const hashed = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);
      }
    }
  } catch (e) {
    // 如果验证报错，尝试明文比较（旧数据兼容）
    passwordValid = user.password === password;
    if (passwordValid) {
      const hashed = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);
    }
  }
  
  if (!passwordValid) {
    return res.json({ success: false, message: '手机号或密码错误' });
  }
  
  if (user.status === 'disabled') {
    return res.json({ success: false, message: '账号已被禁用，请联系管理员' });
  }
  
  // 🔑 生成 JWT
  const token = jwt.sign({
    id: user.id,
    phone: user.phone,
    role: user.role || 'user',
    name: user.name
  }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  
  res.json({
    success: true,
    data: { id: user.id, phone: user.phone, name: user.name, role: user.role, token }
  });
});

// 🔒 用户注册（密码加盐存储）
app.post('/api/user/register', async (req, res) => {
  const { phone, password, name } = req.body;
  const db = await getDatabase();
  
  if (!phone || !password) {
    return res.json({ success: false, message: '手机号和密码不能为空' });
  }
  
  if (!validatePhone(phone)) {
    return res.json({ success: false, message: '手机号格式不正确' });
  }
  
  if (password.length < 6) {
    return res.json({ success: false, message: '密码至少6位' });
  }
  
  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return res.json({ success: false, message: '该手机号已被注册' });
  }
  
  // 🔒 密码加盐哈希
  const hashedPassword = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, phone, password, name) VALUES (?, ?, ?, ?)').run(id, phone, hashedPassword, name || '');
  
  res.json({ success: true, message: '注册成功' });
});

// 🔒 管理员登录（密码加盐验证 + JWT）
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const db = await getDatabase();
  
  if (!username || !password) {
    return res.json({ success: false, message: '请输入用户名和密码' });
  }
  
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  
  if (!admin) {
    return res.json({ success: false, message: '用户名或密码错误' });
  }
  
  // ⚡ 密码验证（兼容新旧）
  let passwordValid = false;
  try {
    if (admin.password.startsWith('$2a$') || admin.password.startsWith('$2b$')) {
      passwordValid = bcrypt.compareSync(password, admin.password);
    } else {
      passwordValid = admin.password === password;
      if (passwordValid) {
        const hashed = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
        db.prepare('UPDATE admins SET password = ? WHERE id = ?').run(hashed, admin.id);
      }
    }
  } catch (e) {
    passwordValid = admin.password === password;
    if (passwordValid) {
      const hashed = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
      db.prepare('UPDATE admins SET password = ? WHERE id = ?').run(hashed, admin.id);
    }
  }
  
  if (!passwordValid) {
    return res.json({ success: false, message: '用户名或密码错误' });
  }
  
  // 🔑 生成 JWT
  const token = jwt.sign({
    id: admin.id,
    username: admin.username,
    name: admin.name,
    role: admin.role || 'admin'
  }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  
  res.json({
    success: true,
    data: { id: admin.id, username: admin.username, name: admin.name, role: admin.role, token }
  });
});

// ==================== 隐患管理 ====================

// 🔒 获取隐患列表（需鉴权）
app.get('/api/hazards', authMiddleware, async (req, res) => {
  const { status, category_id, keyword, page = 1, pageSize = 10, user_id, is_admin } = req.query;
  const db = await getDatabase();
  
  let sql = `
    SELECT h.*, c.name as category_name, ht.name as hazard_type_name,
           ht.regulation, ht.regulation_article, ht.regulation_content
    FROM hazards h
    LEFT JOIN categories c ON h.category_id = c.id
    LEFT JOIN hazard_types ht ON h.hazard_type_id = ht.id
    WHERE 1=1
  `;
  const params = [];

  if (is_admin !== 'true' && user_id) {
    sql += ' AND h.user_id = ?';
    params.push(user_id);
  }

  if (status) {
    sql += ' AND h.status = ?';
    params.push(status);
  }
  if (category_id) {
    sql += ' AND h.category_id = ?';
    params.push(category_id);
  }
  if (keyword) {
    const kw = sanitize(keyword);
    sql += ' AND (h.title LIKE ? OR h.description LIKE ? OR h.location LIKE ?)';
    params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
  }

  // 安全的COUNT查询
  const total = db.prepare('SELECT COUNT(*) as total FROM hazards h WHERE 1=1' + 
    (is_admin !== 'true' && user_id ? ' AND h.user_id = ?' : '') +
    (status ? ' AND h.status = ?' : '') +
    (category_id ? ' AND h.category_id = ?' : '') +
    (keyword ? ' AND (h.title LIKE ? OR h.description LIKE ? OR h.location LIKE ?)' : '')
  ).get(...params);

  sql += ' ORDER BY h.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));

  const list = db.prepare(sql).all(...params);

  res.json({ success: true, data: { list, total: total.total, page: parseInt(page), pageSize: parseInt(pageSize) } });
});

// 🔒 获取隐患详情（需鉴权）
app.get('/api/hazards/:id', authMiddleware, async (req, res) => {
  const db = await getDatabase();
  const hazard = db.prepare(`
    SELECT h.*, c.name as category_name, ht.name as hazard_type_name,
           ht.regulation, ht.regulation_article, ht.regulation_content
    FROM hazards h
    LEFT JOIN categories c ON h.category_id = c.id
    LEFT JOIN hazard_types ht ON h.hazard_type_id = ht.id
    WHERE h.id = ?
  `).get(req.params.id);

  if (!hazard) {
    return res.status(404).json({ success: false, message: '未找到该隐患' });
  }

  res.json({ success: true, data: hazard });
});

// 🔒 上报隐患（需鉴权）
app.post('/api/hazards', authMiddleware, async (req, res) => {
  const db = await getDatabase();
  const { category_id, hazard_type_id, title, description, location, reporter_name, reporter_phone, risk_level, user_id } = req.body;
  
  if (!title) {
    return res.json({ success: false, message: '隐患标题不能为空' });
  }
  
  if (title.length > 200) {
    return res.json({ success: false, message: '隐患标题不能超过200字' });
  }

  const id = uuidv4();
  
  db.prepare(`
    INSERT INTO hazards (id, user_id, category_id, hazard_type_id, title, description, location, reporter_name, reporter_phone, risk_level)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, user_id || 'anonymous', category_id, hazard_type_id, title, description, location, reporter_name, reporter_phone, risk_level);

  res.json({ success: true, data: { id }, message: '上报成功' });
});

// 🔒 更新隐患状态（需管理员权限）
app.put('/api/hazards/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDatabase();
  const { status, handler_name, handle_result } = req.body;
  
  if (!status) {
    return res.json({ success: false, message: '状态不能为空' });
  }
  
  db.prepare(`
    UPDATE hazards 
    SET status = ?, handler_name = ?, handle_result = ?, 
        handled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, handler_name, handle_result, req.params.id);
  
  res.json({ success: true, message: '更新成功' });
});

// 🔒 删除隐患（需管理员权限）
app.delete('/api/hazards/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDatabase();
  db.prepare('DELETE FROM hazards WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: '删除成功' });
});

// 🔒 获取统计数据（需鉴权）
app.get('/api/statistics', authMiddleware, async (req, res) => {
  const db = await getDatabase();
  
  const total = db.prepare('SELECT COUNT(*) as count FROM hazards').get().count;
  const pending = db.prepare("SELECT COUNT(*) as count FROM hazards WHERE status = '待处理'").get().count;
  const processing = db.prepare("SELECT COUNT(*) as count FROM hazards WHERE status = '处理中'").get().count;
  const completed = db.prepare("SELECT COUNT(*) as count FROM hazards WHERE status = '已处理'").get().count;

  const byCategory = db.prepare(`
    SELECT c.name, COUNT(h.id) as count
    FROM categories c
    LEFT JOIN hazards h ON c.id = h.category_id
    GROUP BY c.id
    ORDER BY count DESC
  `).all();

  const byRiskLevel = db.prepare(`
    SELECT risk_level, COUNT(*) as count
    FROM hazards
    GROUP BY risk_level
  `).all();

  res.json({ success: true, data: { total, pending, processing, completed, byCategory, byRiskLevel } });
});

// ==================== 用户管理（管理员） ====================

// 🔒 获取用户列表（需管理员权限）
app.get('/api/admin/users', adminAuthMiddleware, async (req, res) => {
  const { keyword, page = 1, pageSize = 10 } = req.query;
  const db = await getDatabase();
  
  let sql = 'SELECT id, phone, name, role, status, created_at FROM users WHERE 1=1';
  const params = [];
  
  if (keyword) {
    const kw = sanitize(keyword);
    sql += ' AND (phone LIKE ? OR name LIKE ?)';
    params.push(`%${kw}%`, `%${kw}%`);
  }
  
  const total = db.prepare('SELECT COUNT(*) as total FROM users WHERE 1=1' + 
    (keyword ? ' AND (phone LIKE ? OR name LIKE ?)' : '')).get(...params);
  
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(pageSize), (parseInt(page) - 1) * parseInt(pageSize));
  
  const list = db.prepare(sql).all(...params);
  
  res.json({ success: true, data: { list, total: total.total, page: parseInt(page), pageSize: parseInt(pageSize) } });
});

// 🔒 添加用户（需管理员权限，密码加盐）
app.post('/api/admin/users', adminAuthMiddleware, async (req, res) => {
  const { phone, password, name } = req.body;
  const db = await getDatabase();
  
  if (!phone || !password) {
    return res.json({ success: false, message: '手机号和密码不能为空' });
  }
  
  if (!validatePhone(phone)) {
    return res.json({ success: false, message: '手机号格式不正确' });
  }
  
  if (password.length < 6) {
    return res.json({ success: false, message: '密码至少6位' });
  }
  
  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (existing) {
    return res.json({ success: false, message: '该手机号已存在' });
  }
  
  const hashedPassword = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, phone, password, name) VALUES (?, ?, ?, ?)').run(id, phone, hashedPassword, name || '');
  
  res.json({ success: true, message: '添加成功', data: { id } });
});

// 🔒 更新用户（需管理员权限）
app.put('/api/admin/users/:id', adminAuthMiddleware, async (req, res) => {
  const { phone, password, name, status } = req.body;
  const db = await getDatabase();
  
  if (password) {
    const hashedPassword = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
    db.prepare('UPDATE users SET phone = ?, password = ?, name = ?, status = ? WHERE id = ?')
      .run(phone, hashedPassword, name, status, req.params.id);
  } else {
    db.prepare('UPDATE users SET phone = ?, name = ?, status = ? WHERE id = ?')
      .run(phone, name, status, req.params.id);
  }
  res.json({ success: true, message: '更新成功' });
});

// 🔒 删除用户（需管理员权限）
app.delete('/api/admin/users/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDatabase();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: '删除成功' });
});

// 🔒 重置密码（需管理员权限）
app.post('/api/admin/users/:id/reset-password', adminAuthMiddleware, async (req, res) => {
  const { new_password } = req.body;
  const db = await getDatabase();
  
  if (!new_password) {
    return res.json({ success: false, message: '新密码不能为空' });
  }
  
  if (new_password.length < 6) {
    return res.json({ success: false, message: '密码至少6位' });
  }
  
  const hashedPassword = bcrypt.hashSync(new_password, BCRYPT_SALT_ROUNDS);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);
  res.json({ success: true, message: '密码重置成功' });
});

// ==================== 分类管理（管理员） ====================

// 🔒 添加分类（需管理员权限）
app.post('/api/admin/categories', adminAuthMiddleware, async (req, res) => {
  const { name, icon, description, sort_order } = req.body;
  const db = await getDatabase();
  
  if (!name) {
    return res.json({ success: false, message: '分类名称不能为空' });
  }
  
  db.prepare('INSERT INTO categories (name, icon, description, sort_order) VALUES (?, ?, ?, ?)').run(name, icon, description, sort_order || 0);
  res.json({ success: true, message: '添加成功' });
});

// 🔒 更新分类（需管理员权限）
app.put('/api/admin/categories/:id', adminAuthMiddleware, async (req, res) => {
  const { name, icon, description, sort_order } = req.body;
  const db = await getDatabase();
  db.prepare('UPDATE categories SET name = ?, icon = ?, description = ?, sort_order = ? WHERE id = ?').run(name, icon, description, sort_order, req.params.id);
  res.json({ success: true, message: '更新成功' });
});

// 🔒 删除分类（需管理员权限）
app.delete('/api/admin/categories/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDatabase();
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: '删除成功' });
});

// ==================== 隐患类型管理（管理员） ====================

// 🔒 添加隐患类型
app.post('/api/admin/hazard-types', adminAuthMiddleware, async (req, res) => {
  const { category_id, name, description, risk_level, regulation, regulation_article, regulation_content } = req.body;
  const db = await getDatabase();
  db.prepare('INSERT INTO hazard_types (category_id, name, description, risk_level, regulation, regulation_article, regulation_content) VALUES (?, ?, ?, ?, ?, ?, ?)').run(category_id, name, description, risk_level, regulation, regulation_article, regulation_content);
  res.json({ success: true, message: '添加成功' });
});

// 🔒 更新隐患类型
app.put('/api/admin/hazard-types/:id', adminAuthMiddleware, async (req, res) => {
  const { category_id, name, description, risk_level, regulation, regulation_article, regulation_content } = req.body;
  const db = await getDatabase();
  db.prepare('UPDATE hazard_types SET category_id = ?, name = ?, description = ?, risk_level = ?, regulation = ?, regulation_article = ?, regulation_content = ? WHERE id = ?').run(category_id, name, description, risk_level, regulation, regulation_article, regulation_content, req.params.id);
  res.json({ success: true, message: '更新成功' });
});

// 🔒 删除隐患类型
app.delete('/api/admin/hazard-types/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDatabase();
  db.prepare('DELETE FROM hazard_types WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: '删除成功' });
});

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'OK', timestamp: new Date().toISOString() });
});

// ==================== 全局错误处理 ====================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: '请求来源不允许' });
  }
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// ==================== 本地启动 ====================
if (require.main === module) {
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const PORT = process.env.PORT || 3110;
  app.listen(PORT, () => {
    console.log('✅ 隐患排查管理系统已启动');
    console.log('   🌐 网站地址: http://localhost:' + PORT);
    console.log('   🔑 默认账号: admin / admin123');
    console.log('   ⚡ API接口: http://localhost:' + PORT + '/api/');
  });
}

// 导出为 Vercel Serverless Function
module.exports = app;