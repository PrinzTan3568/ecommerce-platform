const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { database } = require('../utils/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// 应用管理员权限中间件
router.use(verifyToken, requireRole(['admin']));

// ============================================
// 用户管理
// ============================================

// 获取用户列表
router.get('/users', (req, res) => {
  try {
    const { page = 1, limit = 20, role, status, search } = req.query;

    let users = Array.from(database.users.values());

    // 搜索过滤
    if (search) {
      const searchTerm = search.toLowerCase();
      users = users.filter(user => 
        user.username.toLowerCase().includes(searchTerm) ||
        user.email.toLowerCase().includes(searchTerm) ||
        user.profile.nickname.toLowerCase().includes(searchTerm)
      );
    }

    // 角色过滤
    if (role) {
      users = users.filter(user => user.role === role);
    }

    // 状态过滤
    if (status) {
      users = users.filter(user => user.status === status);
    }

    // 排序
    users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 分页
    const total = users.length;
    const startIndex = (page - 1) * limit;
    const paginatedUsers = users.slice(startIndex, startIndex + parseInt(limit));

    // 移除密码字段
    const safeUsers = paginatedUsers.map(({ password, ...user }) => user);

    res.json({
      success: true,
      data: {
        users: safeUsers,
        pagination: {
          current: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取用户列表失败',
      error: error.message
    });
  }
});

// 创建用户
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, role, profile = {} } = req.body;

    // 验证必填字段
    if (!username || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: '用户名、邮箱、密码和角色都是必填的'
      });
    }

    // 检查用户是否已存在
    const existingUser = Array.from(database.users.values())
      .find(u => u.username === username || u.email === email);
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '用户名或邮箱已存在'
      });
    }

    // 创建新用户
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = {
      id: uuidv4(),
      username,
      email,
      password: hashedPassword,
      role,
      profile: {
        nickname: profile.nickname || username,
        avatar: profile.avatar || '',
        memberLevel: role === 'customer' ? 1 : 2,
        points: profile.points || 0,
        wallet: profile.wallet || 0,
        ...profile
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user.id
    };

    database.users.set(newUser.id, newUser);

    // 返回结果（不返回密码）
    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      success: true,
      message: '用户创建成功',
      data: userWithoutPassword
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '创建用户失败',
      error: error.message
    });
  }
});

// 更新用户
router.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    const user = database.users.get(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 处理密码更新
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 12);
    }

    // 更新用户信息
    Object.keys(updates).forEach(key => {
      if (key === 'profile' && typeof updates.profile === 'object') {
        user.profile = { ...user.profile, ...updates.profile };
      } else if (key !== 'id' && key !== 'createdAt') {
        user[key] = updates[key];
      }
    });

    user.updatedAt = new Date();
    user.updatedBy = req.user.id;

    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: '用户更新成功',
      data: userWithoutPassword
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '更新用户失败',
      error: error.message
    });
  }
});

// 删除用户
router.delete('/users/:userId', (req, res) => {
  try {
    const { userId } = req.params;

    if (!database.users.has(userId)) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 软删除
    const user = database.users.get(userId);
    user.status = 'deleted';
    user.deletedAt = new Date();
    user.deletedBy = req.user.id;

    res.json({
      success: true,
      message: '用户删除成功'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '删除用户失败',
      error: error.message
    });
  }
});

// ============================================
// 商品管理
// ============================================

// 商品审核
router.patch('/products/:productId/approve', (req, res) => {
  try {
    const { productId } = req.params;
    const { status, reviewComments } = req.body; // approved, rejected

    const product = database.products.get(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '商品不存在'
      });
    }

    product.status = status;
    product.reviewStatus = status;
    product.reviewComments = reviewComments;
    product.reviewedBy = req.user.id;
    product.reviewedAt = new Date();
    product.updatedAt = new Date();

    // 通知供应商
    if (product.supplierId) {
      database.notifications.push({
        id: uuidv4(),
        type: 'product_review',
        title: '商品审核通知',
        message: `您的商品《${product.name}》审核${status === 'approved' ? '通过' : '被拒绝'}`,
        recipientId: product.supplierId,
        recipientType: 'user',
        data: { productId, status, comments: reviewComments },
        isRead: false,
        createdAt: new Date()
      });
    }

    res.json({
      success: true,
      message: `商品${status === 'approved' ? '审核通过' : '审核拒绝'}`,
      data: product
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '商品审核失败',
      error: error.message
    });
  }
});

// 批量操作商品
router.post('/products/batch', (req, res) => {
  try {
    const { action, productIds, data } = req.body;

    if (!productIds || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请选择要操作的商品'
      });
    }

    const results = [];

    productIds.forEach(productId => {
      const product = database.products.get(productId);
      if (product) {
        switch (action) {
          case 'activate':
            product.status = 'active';
            break;
          case 'deactivate':
            product.status = 'inactive';
            break;
          case 'delete':
            product.status = 'deleted';
            product.deletedAt = new Date();
            break;
          case 'update_category':
            if (data.category) product.category = data.category;
            break;
          case 'update_tags':
            if (data.tags) product.tags = data.tags;
            break;
        }
        product.updatedAt = new Date();
        results.push({ id: productId, success: true });
      } else {
        results.push({ id: productId, success: false, error: '商品不存在' });
      }
    });

    res.json({
      success: true,
      message: '批量操作完成',
      data: results
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '批量操作失败',
      error: error.message
    });
  }
});

// ============================================
// 营销工具管理
// ============================================

// 获取优惠券列表
router.get('/coupons', (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;

    let coupons = Array.from(database.coupons.values());

    if (status) {
      coupons = coupons.filter(coupon => coupon.status === status);
    }

    if (type) {
      coupons = coupons.filter(coupon => coupon.type === type);
    }

    // 排序
    coupons.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 分页
    const total = coupons.length;
    const startIndex = (page - 1) * limit;
    const paginatedCoupons = coupons.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        coupons: paginatedCoupons,
        pagination: {
          current: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取优惠券列表失败',
      error: error.message
    });
  }
});

// 创建优惠券
router.post('/coupons', (req, res) => {
  try {
    const {
      name,
      code,
      type, // percentage, fixed
      value,
      minAmount = 0,
      maxDiscount,
      maxUsage = 1000,
      validFrom,
      validTo,
      applicableProducts = [],
      applicableCategories = [],
      userRestrictions = {} // 用户限制
    } = req.body;

    // 验证必填字段
    if (!name || !code || !type || !value) {
      return res.status(400).json({
        success: false,
        message: '请填写完整的优惠券信息'
      });
    }

    // 检查优惠券码是否已存在
    const existingCoupon = Array.from(database.coupons.values())
      .find(c => c.code === code);
    
    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: '优惠券码已存在'
      });
    }

    const newCoupon = {
      id: uuidv4(),
      name,
      code: code.toUpperCase(),
      type,
      value,
      minAmount,
      maxDiscount,
      maxUsage,
      usageCount: 0,
      validFrom: new Date(validFrom),
      validTo: new Date(validTo),
      applicableProducts,
      applicableCategories,
      userRestrictions,
      status: 'active',
      createdAt: new Date(),
      createdBy: req.user.id
    };

    database.coupons.set(newCoupon.id, newCoupon);

    res.status(201).json({
      success: true,
      message: '优惠券创建成功',
      data: newCoupon
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '创建优惠券失败',
      error: error.message
    });
  }
});

// 更新优惠券
router.patch('/coupons/:couponId', (req, res) => {
  try {
    const { couponId } = req.params;
    const updates = req.body;

    const coupon = database.coupons.get(couponId);
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: '优惠券不存在'
      });
    }

    // 更新优惠券信息
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'createdAt' && key !== 'usageCount') {
        coupon[key] = updates[key];
      }
    });

    coupon.updatedAt = new Date();
    coupon.updatedBy = req.user.id;

    res.json({
      success: true,
      message: '优惠券更新成功',
      data: coupon
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '更新优惠券失败',
      error: error.message
    });
  }
});

// ============================================
// 直播管理
// ============================================

// 获取直播列表
router.get('/live-streams', (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    let liveStreams = Array.from(database.liveStreams.values());

    if (status) {
      liveStreams = liveStreams.filter(stream => stream.status === status);
    }

    // 排序
    liveStreams.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 分页
    const total = liveStreams.length;
    const startIndex = (page - 1) * limit;
    const paginatedStreams = liveStreams.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        liveStreams: paginatedStreams,
        pagination: {
          current: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取直播列表失败',
      error: error.message
    });
  }
});

// 审核直播
router.patch('/live-streams/:streamId/approve', (req, res) => {
  try {
    const { streamId } = req.params;
    const { status, reviewComments } = req.body; // approved, rejected

    const liveStream = database.liveStreams.get(streamId);
    if (!liveStream) {
      return res.status(404).json({
        success: false,
        message: '直播不存在'
      });
    }

    liveStream.status = status;
    liveStream.reviewComments = reviewComments;
    liveStream.reviewedBy = req.user.id;
    liveStream.reviewedAt = new Date();

    // 通知主播
    if (liveStream.hostId) {
      database.notifications.push({
        id: uuidv4(),
        type: 'live_review',
        title: '直播审核通知',
        message: `您的直播《${liveStream.title}》审核${status === 'approved' ? '通过' : '被拒绝'}`,
        recipientId: liveStream.hostId,
        recipientType: 'user',
        data: { streamId, status, comments: reviewComments },
        isRead: false,
        createdAt: new Date()
      });
    }

    res.json({
      success: true,
      message: `直播${status === 'approved' ? '审核通过' : '审核拒绝'}`,
      data: liveStream
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '直播审核失败',
      error: error.message
    });
  }
});

// ============================================
// 系统配置管理
// ============================================

// 获取系统配置
router.get('/settings', (req, res) => {
  try {
    const settings = database.systemSettings || {
      siteName: '综合电商平台',
      siteDescription: 'O2O+S2B2B2C+营销工具+直播系统',
      logo: '/images/logo.png',
      contact: {
        email: 'contact@example.com',
        phone: '+86 400-123-4567',
        address: '北京市朝阳区xxx街道xxx号'
      },
      business: {
        defaultCommissionRate: 0.05, // 默认佣金率
        pointsExchangeRate: 100, // 积分兑换比例
        freeShippingThreshold: 99, // 包邮门槛
        returnDays: 7, // 退货天数
        maxRefundDays: 30 // 最大退款天数
      },
      payment: {
        enabledMethods: ['wechat', 'alipay', 'bank'],
        defaultCurrency: 'CNY'
      },
      notification: {
        enableSMS: true,
        enableEmail: true,
        enablePush: true
      },
      live: {
        maxStreamDuration: 480, // 最大直播时长(分钟)
        enableRecording: true,
        watermarkEnabled: true
      }
    };

    res.json({
      success: true,
      data: settings
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取系统配置失败',
      error: error.message
    });
  }
});

// 更新系统配置
router.patch('/settings', (req, res) => {
  try {
    const updates = req.body;

    if (!database.systemSettings) {
      database.systemSettings = {};
    }

    // 深度合并配置
    function deepMerge(target, source) {
      for (let key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) target[key] = {};
          deepMerge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    }

    deepMerge(database.systemSettings, updates);
    database.systemSettings.updatedAt = new Date();
    database.systemSettings.updatedBy = req.user.id;

    res.json({
      success: true,
      message: '系统配置更新成功',
      data: database.systemSettings
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '更新系统配置失败',
      error: error.message
    });
  }
});

// ============================================
// 数据统计
// ============================================

// 平台总览统计
router.get('/stats/overview', (req, res) => {
  try {
    const users = Array.from(database.users.values());
    const products = Array.from(database.products.values());
    const orders = Array.from(database.orders.values());

    // 今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayOrders = orders.filter(order => new Date(order.createdAt) >= today);
    const todayRevenue = todayOrders.reduce((sum, order) => sum + order.amount.total, 0);
    const todayUsers = users.filter(user => new Date(user.createdAt) >= today);

    // 用户统计
    const userStats = {
      total: users.filter(u => u.status !== 'deleted').length,
      customers: users.filter(u => u.role === 'customer' && u.status !== 'deleted').length,
      suppliers: users.filter(u => u.role === 'supplier' && u.status !== 'deleted').length,
      retailers: users.filter(u => u.role === 'retailer' && u.status !== 'deleted').length,
      distributors: users.filter(u => u.role === 'distributor' && u.status !== 'deleted').length,
      todayNew: todayUsers.length
    };

    // 商品统计
    const productStats = {
      total: products.filter(p => p.status !== 'deleted').length,
      active: products.filter(p => p.status === 'active').length,
      pending: products.filter(p => p.status === 'pending').length,
      lowStock: products.filter(p => p.inventory.available <= p.inventory.threshold).length
    };

    // 订单统计
    const orderStats = {
      total: orders.length,
      pending: orders.filter(o => o.status === 'pending').length,
      paid: orders.filter(o => o.status === 'paid').length,
      shipped: orders.filter(o => o.status === 'shipped').length,
      delivered: orders.filter(o => o.status === 'delivered').length,
      cancelled: orders.filter(o => o.status === 'cancelled').length,
      todayCount: todayOrders.length,
      todayRevenue
    };

    // 收入统计
    const totalRevenue = orders.filter(o => o.paymentStatus === 'paid')
      .reduce((sum, order) => sum + order.amount.total, 0);

    const stats = {
      users: userStats,
      products: productStats,
      orders: orderStats,
      revenue: {
        total: totalRevenue,
        today: todayRevenue,
        averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取统计数据失败',
      error: error.message
    });
  }
});

// 销售趋势统计
router.get('/stats/sales-trend', (req, res) => {
  try {
    const { period = '7d' } = req.query; // 7d, 30d, 90d, 1y

    const orders = Array.from(database.orders.values())
      .filter(order => order.paymentStatus === 'paid');

    let days;
    switch (period) {
      case '30d': days = 30; break;
      case '90d': days = 90; break;
      case '1y': days = 365; break;
      default: days = 7;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const trendData = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      
      const dayOrders = orders.filter(order => {
        const orderDate = new Date(order.createdAt);
        return orderDate.toDateString() === date.toDateString();
      });

      trendData.push({
        date: date.toISOString().split('T')[0],
        orders: dayOrders.length,
        revenue: dayOrders.reduce((sum, order) => sum + order.amount.total, 0)
      });
    }

    res.json({
      success: true,
      data: trendData
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取销售趋势失败',
      error: error.message
    });
  }
});

// ============================================
// 通知管理
// ============================================

// 发送系统通知
router.post('/notifications/broadcast', (req, res) => {
  try {
    const { title, message, targetUsers = 'all', userRoles = [], specificUsers = [] } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: '标题和内容不能为空'
      });
    }

    let recipients = [];

    if (targetUsers === 'all') {
      recipients = Array.from(database.users.values())
        .filter(user => user.status === 'active')
        .map(user => user.id);
    } else if (targetUsers === 'roles' && userRoles.length > 0) {
      recipients = Array.from(database.users.values())
        .filter(user => user.status === 'active' && userRoles.includes(user.role))
        .map(user => user.id);
    } else if (targetUsers === 'specific' && specificUsers.length > 0) {
      recipients = specificUsers;
    }

    // 创建通知
    recipients.forEach(userId => {
      database.notifications.push({
        id: uuidv4(),
        type: 'system_broadcast',
        title,
        message,
        recipientId: userId,
        recipientType: 'user',
        data: {},
        isRead: false,
        createdAt: new Date(),
        senderId: req.user.id
      });
    });

    res.json({
      success: true,
      message: `成功发送通知给 ${recipients.length} 个用户`,
      data: { recipients: recipients.length }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '发送通知失败',
      error: error.message
    });
  }
});

// 获取系统日志
router.get('/logs', (req, res) => {
  try {
    const { page = 1, limit = 50, type, level } = req.query;

    // 模拟系统日志数据
    let logs = database.systemLogs || [];

    if (type) {
      logs = logs.filter(log => log.type === type);
    }

    if (level) {
      logs = logs.filter(log => log.level === level);
    }

    // 排序
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 分页
    const total = logs.length;
    const startIndex = (page - 1) * limit;
    const paginatedLogs = logs.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        logs: paginatedLogs,
        pagination: {
          current: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取系统日志失败',
      error: error.message
    });
  }
});

module.exports = router;
