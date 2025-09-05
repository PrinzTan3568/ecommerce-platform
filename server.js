const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// 导入路由
const authRoutes = require('./src/routes/auth');
const productRoutes = require('./src/routes/products');
const orderRoutes = require('./src/routes/orders');
const adminRoutes = require('./src/routes/admin');

// 导入数据库
const { initDatabase } = require('./src/utils/database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// 安全中间件
app.use(helmet());
app.use(compression());

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 每个IP最多100个请求
  message: {
    error: '请求过于频繁，请稍后再试'
  }
});
app.use('/api/', limiter);

// CORS配置
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));

// 基础中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 初始化数据库
initDatabase();

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);

// 根路由 - API文档
app.get('/api', (req, res) => {
  res.json({
    message: '🎉 综合电商平台 API',
    version: '1.0.0',
    features: [
      'O2O电商平台',
      'S2B2B2C业务模式', 
      '营销工具系统',
      '直播带货功能',
      '多角色权限管理'
    ],
    endpoints: {
      auth: '/api/auth',
      products: '/api/products', 
      orders: '/api/orders',
      admin: '/api/admin'
    },
    demo: {
      admin: { username: 'admin', password: 'admin123' },
      customer: { username: 'demo', password: 'demo123' }
    },
    docs: '/api/docs',
    admin_panel: '/admin.html'
  });
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('🔗 用户连接:', socket.id);
  
  // 加入直播间
  socket.on('join-live-room', (roomId) => {
    socket.join(roomId);
    socket.emit('joined-room', { roomId, message: '成功加入直播间' });
  });
  
  // 直播消息
  socket.on('live-message', (data) => {
    socket.to(data.roomId).emit('new-message', {
      id: Date.now(),
      user: data.user,
      message: data.message,
      timestamp: new Date()
    });
  });
  
  // 商品推荐
  socket.on('recommend-product', (data) => {
    socket.to(data.roomId).emit('product-recommended', data);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 用户断开连接:', socket.id);
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? '服务器内部错误' 
      : err.message
  });
});

// 404处理
app.use((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.status(404).json({
      success: false,
      message: 'API端点不存在'
    });
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`🚀 服务器运行在端口 ${PORT}`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`📊 管理后台: http://localhost:${PORT}/admin.html`);
  console.log(`📖 API文档: http://localhost:${PORT}/api`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，开始优雅关闭...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

module.exports = app;
