// ============================================
// 文件: src/routes/marketing.js - 营销工具路由
// ============================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { database } = require('../utils/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================
// 拼团活动
// ============================================

// 创建拼团活动
router.post('/group-buying', verifyToken, requireRole(['admin', 'supplier']), (req, res) => {
  try {
    const {
      productId,
      title,
      description,
      groupSize,
      originalPrice,
      groupPrice,
      startTime,
      endTime,
      maxGroups = 100
    } = req.body;

    const product = database.products.get(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '商品不存在'
      });
    }

    const groupBuying = {
      id: uuidv4(),
      productId,
      title,
      description,
      groupSize,
      originalPrice,
      groupPrice,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      maxGroups,
      currentGroups: 0,
      totalParticipants: 0,
      status: 'active', // active, expired, completed
      createdBy: req.user.id,
      createdAt: new Date()
    };

    if (!database.groupBuyingActivities) {
      database.groupBuyingActivities = new Map();
    }
    
    database.groupBuyingActivities.set(groupBuying.id, groupBuying);

    res.status(201).json({
      success: true,
      message: '拼团活动创建成功',
      data: groupBuying
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '创建拼团活动失败',
      error: error.message
    });
  }
});

// 参与拼团
router.post('/group-buying/:activityId/join', verifyToken, (req, res) => {
  try {
    const { activityId } = req.params;
    const { groupId, quantity = 1 } = req.body;

    if (!database.groupBuyingActivities) {
      database.groupBuyingActivities = new Map();
    }

    const activity = database.groupBuyingActivities.get(activityId);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: '拼团活动不存在'
      });
    }

    // 检查活动是否有效
    const now = new Date();
    if (now < activity.startTime || now > activity.endTime) {
      return res.status(400).json({
        success: false,
        message: '拼团活动未开始或已结束'
      });
    }

    if (!database.groupBuyingGroups) {
      database.groupBuyingGroups = new Map();
    }

    let group;
    if (groupId) {
      // 加入现有团
      group = database.groupBuyingGroups.get(groupId);
      if (!group || group.status !== 'recruiting') {
        return res.status(400).json({
          success: false,
          message: '该团不存在或已满员'
        });
      }
    } else {
      // 开团
      group = {
        id: uuidv4(),
        activityId,
        leaderId: req.user.id,
        participants: [],
        requiredSize: activity.groupSize,
        currentSize: 0,
        status: 'recruiting', // recruiting, completed, expired
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期
      };
      database.groupBuyingGroups.set(group.id, group);
      activity.currentGroups++;
    }

    // 检查用户是否已参与此团
    const existingParticipant = group.participants.find(p => p.userId === req.user.id);
    if (existingParticipant) {
      return res.status(400).json({
        success: false,
        message: '您已参与此拼团'
      });
    }

    // 添加参与者
    const participant = {
      userId: req.user.id,
      username: req.user.username,
      quantity,
      joinedAt: new Date()
    };

    group.participants.push(participant);
    group.currentSize++;

    // 检查是否成团
    if (group.currentSize >= group.requiredSize) {
      group.status = 'completed';
      group.completedAt = new Date();

      // 为所有参与者创建订单
      group.participants.forEach(p => {
        const order = {
          id: uuidv4(),
          orderNo: 'GB' + Date.now() + Math.floor(Math.random() * 1000),
          userId: p.userId,
          items: [{
            productId: activity.productId,
            quantity: p.quantity,
            price: activity.groupPrice,
            total: activity.groupPrice * p.quantity
          }],
          amount: {
            subtotal: activity.groupPrice * p.quantity,
            discount: (activity.originalPrice - activity.groupPrice) * p.quantity,
            total: activity.groupPrice * p.quantity
          },
          orderType: 'group_buying',
          groupBuyingId: activityId,
          groupId: group.id,
          status: 'pending',
          paymentStatus: 'unpaid',
          createdAt: new Date()
        };

        database.orders.set(order.id, order);

        // 通知用户
        database.notifications.push({
          id: uuidv4(),
          type: 'group_buying_success',
          title: '拼团成功',
          message: `恭喜您参与的拼团已成功，请及时支付订单`,
          recipientId: p.userId,
          recipientType: 'user',
          data: { orderId: order.id, groupId: group.id },
          isRead: false,
          createdAt: new Date()
        });
      });
    }

    activity.totalParticipants++;

    res.json({
      success: true,
      message: group.status === 'completed' ? '拼团成功！' : '加入拼团成功',
      data: {
        group,
        activity
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '参与拼团失败',
      error: error.message
    });
  }
});

// ============================================
// 秒杀活动
// ============================================

// 创建秒杀活动
router.post('/flash-sale', verifyToken, requireRole(['admin', 'supplier']), (req, res) => {
  try {
    const {
      productId,
      title,
      originalPrice,
      salePrice,
      inventory,
      startTime,
      endTime,
      limitPerUser = 1
    } = req.body;

    const product = database.products.get(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '商品不存在'
      });
    }

    const flashSale = {
      id: uuidv4(),
      productId,
      title,
      originalPrice,
      salePrice,
      inventory,
      soldCount: 0,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      limitPerUser,
      participants: new Map(), // userId -> quantity
      status: 'scheduled', // scheduled, active, ended, cancelled
      createdBy: req.user.id,
      createdAt: new Date()
    };

    if (!database.flashSales) {
      database.flashSales = new Map();
    }
    
    database.flashSales.set(flashSale.id, flashSale);

    res.status(201).json({
      success: true,
      message: '秒杀活动创建成功',
      data: flashSale
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '创建秒杀活动失败',
      error: error.message
    });
  }
});

// 参与秒杀
router.post('/flash-sale/:saleId/purchase', verifyToken, (req, res) => {
  try {
    const { saleId } = req.params;
    const { quantity = 1 } = req.body;

    if (!database.flashSales) {
      database.flashSales = new Map();
    }

    const flashSale = database.flashSales.get(saleId);
    if (!flashSale) {
      return res.status(404).json({
        success: false,
        message: '秒杀活动不存在'
      });
    }

    // 检查活动状态
    const now = new Date();
    if (now < flashSale.startTime) {
      return res.status(400).json({
        success: false,
        message: '秒杀活动未开始'
      });
    }

    if (now > flashSale.endTime) {
      return res.status(400).json({
        success: false,
        message: '秒杀活动已结束'
      });
    }

    // 检查库存
    if (flashSale.soldCount + quantity > flashSale.inventory) {
      return res.status(400).json({
        success: false,
        message: '库存不足'
      });
    }

    // 检查用户购买限制
    const userPurchased = flashSale.participants.get(req.user.id) || 0;
    if (userPurchased + quantity > flashSale.limitPerUser) {
      return res.status(400).json({
        success: false,
        message: `每人限购 ${flashSale.limitPerUser} 件`
      });
    }

    // 创建订单
    const order = {
      id: uuidv4(),
      orderNo: 'FS' + Date.now() + Math.floor(Math.random() * 1000),
      userId: req.user.id,
      items: [{
        productId: flashSale.productId,
        quantity,
        price: flashSale.salePrice,
        total: flashSale.salePrice * quantity
      }],
      amount: {
        subtotal: flashSale.salePrice * quantity,
        discount: (flashSale.originalPrice - flashSale.salePrice) * quantity,
        total: flashSale.salePrice * quantity
      },
      orderType: 'flash_sale',
      flashSaleId: saleId,
      status: 'pending',
      paymentStatus: 'unpaid',
      createdAt: new Date()
    };

    database.orders.set(order.id, order);

    // 更新秒杀数据
    flashSale.soldCount += quantity;
    flashSale.participants.set(req.user.id, userPurchased + quantity);

    res.json({
      success: true,
      message: '秒杀成功，请及时支付',
      data: order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '秒杀失败',
      error: error.message
    });
  }
});

// ============================================
// 积分商城
// ============================================

// 获取积分商城商品
router.get('/points-mall', (req, res) => {
  try {
    const { page = 1, limit = 20, category } = req.query;

    if (!database.pointsMallItems) {
      database.pointsMallItems = new Map();
    }

    let items = Array.from(database.pointsMallItems.values())
      .filter(item => item.status === 'active');

    if (category) {
      items = items.filter(item => item.category === category);
    }

    // 分页
    const total = items.length;
    const startIndex = (page - 1) * limit;
    const paginatedItems = items.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        items: paginatedItems,
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
      message: '获取积分商城商品失败',
      error: error.message
    });
  }
});

// 积分兑换
router.post('/points-mall/:itemId/exchange', verifyToken, (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity = 1 } = req.body;

    if (!database.pointsMallItems) {
      database.pointsMallItems = new Map();
    }

    const item = database.pointsMallItems.get(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: '积分商品不存在'
      });
    }

    const totalPointsNeeded = item.pointsRequired * quantity;
    const totalCashNeeded = item.cashRequired ? item.cashRequired * quantity : 0;

    // 检查用户积分
    if (req.user.profile.points < totalPointsNeeded) {
      return res.status(400).json({
        success: false,
        message: '积分不足'
      });
    }

    // 检查用户钱包（如果需要现金）
    if (totalCashNeeded > 0 && req.user.profile.wallet < totalCashNeeded) {
      return res.status(400).json({
        success: false,
        message: '钱包余额不足'
      });
    }

    // 检查库存
    if (item.inventory < quantity) {
      return res.status(400).json({
        success: false,
        message: '库存不足'
      });
    }

    // 创建兑换订单
    const exchange = {
      id: uuidv4(),
      userId: req.user.id,
      itemId,
      itemName: item.name,
      quantity,
      pointsUsed: totalPointsNeeded,
      cashUsed: totalCashNeeded,
      status: 'pending', // pending, completed, cancelled
      createdAt: new Date()
    };

    if (!database.pointsExchanges) {
      database.pointsExchanges = new Map();
    }
    database.pointsExchanges.set(exchange.id, exchange);

    // 扣除用户积分和现金
    req.user.profile.points -= totalPointsNeeded;
    if (totalCashNeeded > 0) {
      req.user.profile.wallet -= totalCashNeeded;
    }

    // 减少库存
    item.inventory -= quantity;
    item.exchangeCount = (item.exchangeCount || 0) + quantity;

    res.json({
      success: true,
      message: '兑换成功',
      data: exchange
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '积分兑换失败',
      error: error.message
    });
  }
});

// ============================================
// 会员等级系统
// ============================================

// 获取会员等级配置
router.get('/membership/levels', (req, res) => {
  try {
    const membershipLevels = database.membershipLevels || [
      {
        level: 1,
        name: '普通会员',
        requiredPoints: 0,
        benefits: {
          discountRate: 0,
          pointsMultiplier: 1,
          freeShippingThreshold: 99,
          birthdayDiscount: 0.05
        }
      },
      {
        level: 2,
        name: '银卡会员',
        requiredPoints: 1000,
        benefits: {
          discountRate: 0.02,
          pointsMultiplier: 1.2,
          freeShippingThreshold: 79,
          birthdayDiscount: 0.1
        }
      },
      {
        level: 3,
        name: '金卡会员',
        requiredPoints: 5000,
        benefits: {
          discountRate: 0.05,
          pointsMultiplier: 1.5,
          freeShippingThreshold: 59,
          birthdayDiscount: 0.15
        }
      },
      {
        level: 4,
        name: 'VIP会员',
        requiredPoints: 20000,
        benefits: {
          discountRate: 0.1,
          pointsMultiplier: 2,
          freeShippingThreshold: 0,
          birthdayDiscount: 0.2
        }
      }
    ];

    res.json({
      success: true,
      data: membershipLevels
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取会员等级失败',
      error: error.message
    });
  }
});

// 三级分销系统
router.get('/referral/my-team', verifyToken, (req, res) => {
  try {
    const users = Array.from(database.users.values());
    
    // 一级下线
    const level1 = users.filter(user => user.profile.referrerId === req.user.id);
    
    // 二级下线
    const level1Ids = level1.map(u => u.id);
    const level2 = users.filter(user => level1Ids.includes(user.profile.referrerId));
    
    // 三级下线
    const level2Ids = level2.map(u => u.id);
    const level3 = users.filter(user => level2Ids.includes(user.profile.referrerId));

    // 计算佣金统计
    const orders = Array.from(database.orders.values());
    let totalCommission = 0;
    let thisMonthCommission = 0;
    
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    [...level1, ...level2, ...level3].forEach(user => {
      const userOrders = orders.filter(order => 
        order.userId === user.id && order.paymentStatus === 'paid'
      );
      
      userOrders.forEach(order => {
        let commission = 0;
        if (level1.find(u => u.id === user.id)) {
          commission = order.amount.total * 0.05; // 5%
        } else if (level2.find(u => u.id === user.id)) {
          commission = order.amount.total * 0.03; // 3%
        } else {
          commission = order.amount.total * 0.01; // 1%
        }
        
        totalCommission += commission;
        if (new Date(order.createdAt) >= thisMonth) {
          thisMonthCommission += commission;
        }
      });
    });

    res.json({
      success: true,
      data: {
        teamStats: {
          level1Count: level1.length,
          level2Count: level2.length,
          level3Count: level3.length,
          totalTeam: level1.length + level2.length + level3.length
        },
        commission: {
          total: totalCommission,
          thisMonth: thisMonthCommission
        },
        team: {
          level1: level1.map(({ password, ...user }) => user),
          level2: level2.map(({ password, ...user }) => user),
          level3: level3.map(({ password, ...user }) => user)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取团队信息失败',
      error: error.message
    });
  }
});

module.exports = router;

// ============================================
// 文件: src/routes/live.js - 直播系统路由
// ============================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { database } = require('../utils/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const liveRouter = express.Router();

// ============================================
// 直播间管理
// ============================================

// 创建直播间
liveRouter.post('/rooms', verifyToken, requireRole(['admin', 'supplier', 'retailer']), (req, res) => {
  try {
    const {
      title,
      description,
      coverImage,
      scheduledStartTime,
      products = [], // 推荐商品列表
      tags = [],
      isPublic = true
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: '直播标题不能为空'
      });
    }

    const liveRoom = {
      id: uuidv4(),
      title,
      description,
      coverImage,
      hostId: req.user.id,
      hostInfo: {
        username: req.user.username,
        nickname: req.user.profile.nickname,
        avatar: req.user.profile.avatar
      },
      scheduledStartTime: scheduledStartTime ? new Date(scheduledStartTime) : null,
      actualStartTime: null,
      endTime: null,
      products, // 关联商品ID数组
      tags,
      isPublic,
      status: 'scheduled', // scheduled, live, ended, cancelled
      reviewStatus: req.user.role === 'admin' ? 'approved' : 'pending', // pending, approved, rejected
      viewers: {
        current: 0,
        peak: 0,
        total: 0
      },
      stats: {
        likes: 0,
        shares: 0,
        comments: 0,
        orders: 0,
        sales: 0
      },
      settings: {
        allowComments: true,
        allowGifts: true,
        recordEnabled: true,
        chatModeration: true
      },
      createdAt: new Date()
    };

    if (!database.liveStreams) {
      database.liveStreams = new Map();
    }

    database.liveStreams.set(liveRoom.id, liveRoom);

    // 如果不是管理员创建，需要审核
    if (req.user.role !== 'admin') {
      database.notifications.push({
        id: uuidv4(),
        type: 'live_review_request',
        title: '直播审核请求',
        message: `${req.user.username} 申请创建直播间：${title}`,
        recipientId: 'admin',
        recipientType: 'role',
        data: { liveRoomId: liveRoom.id },
        isRead: false,
        createdAt: new Date()
      });
    }

    res.status(201).json({
      success: true,
      message: req.user.role === 'admin' ? '直播间创建成功' : '直播间创建成功，等待审核',
      data: liveRoom
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '创建直播间失败',
      error: error.message
    });
  }
});

// 获取直播间列表
liveRouter.get('/rooms', (req, res) => {
  try {
    const { page = 1, limit = 20, status, hostId, isLive } = req.query;

    if (!database.liveStreams) {
      database.liveStreams = new Map();
    }

    let liveRooms = Array.from(database.liveStreams.values());

    // 只显示已审核通过的直播间（除非是管理员或房主）
    if (!req.user || req.user.role !== 'admin') {
      liveRooms = liveRooms.filter(room => 
        room.reviewStatus === 'approved' || 
        (req.user && room.hostId === req.user.id)
      );
    }

    // 状态过滤
    if (status) {
      liveRooms = liveRooms.filter(room => room.status === status);
    }

    // 主播过滤
    if (hostId) {
      liveRooms = liveRooms.filter(room => room.hostId === hostId);
    }

    // 正在直播过滤
    if (isLive === 'true') {
      liveRooms = liveRooms.filter(room => room.status === 'live');
    }

    // 排序：正在直播的在前，然后按创建时间
    liveRooms.sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (a.status !== 'live' && b.status === 'live') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // 分页
    const total = liveRooms.length;
    const startIndex = (page - 1) * limit;
    const paginatedRooms = liveRooms.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        liveRooms: paginatedRooms,
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
      message: '获取直播间列表失败',
      error: error.message
    });
  }
});

// 获取直播间详情
liveRouter.get('/rooms/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;

    if (!database.liveStreams) {
      database.liveStreams = new Map();
    }

    const liveRoom = database.liveStreams.get(roomId);
    if (!liveRoom) {
      return res.status(404).json({
        success: false,
        message: '直播间不存在'
      });
    }

    // 权限检查
    const canView = liveRoom.isPublic || 
                   liveRoom.reviewStatus === 'approved' ||
                   (req.user && (req.user.role === 'admin' || req.user.id === liveRoom.hostId));

    if (!canView) {
      return res.status(403).json({
        success: false,
        message: '无权查看此直播间'
      });
    }

    // 获取关联商品详情
    const products = liveRoom.products.map(productId => database.products.get(productId)).filter(Boolean);

    res.json({
      success: true,
      data: {
        ...liveRoom,
        productDetails: products
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取直播间详情失败',
      error: error.message
    });
  }
});

// 开始直播
liveRouter.post('/rooms/:roomId/start', verifyToken, (req, res) => {
  try {
    const { roomId } = req.params;

    if (!database.liveStreams) {
      database.liveStreams = new Map();
    }

    const liveRoom = database.liveStreams.get(roomId);
    if (!liveRoom) {
      return res.status(404).json({
        success: false,
        message: '直播间不存在'
      });
    }

    // 权限检查
    if (liveRoom.hostId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有主播可以开始直播'
      });
    }

    // 状态检查
    if (liveRoom.reviewStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        message: '直播间未通过审核'
      });
    }

    if (liveRoom.status === 'live') {
      return res.status(400).json({
        success: false,
        message: '直播已在进行中'
      });
    }

    // 开始直播
    liveRoom.status = 'live';
    liveRoom.actualStartTime = new Date();

    // 生成推流密钥（模拟）
    const streamKey = `${roomId}_${Date.now()}`;
    liveRoom.streamKey = streamKey;
    liveRoom.streamUrl = `rtmp://live.example.com/live/${streamKey}`;
    liveRoom.playUrl = `https://live.example.com/live/${streamKey}.m3u8`;

    // 通知关注者
    const followers = Array.from(database.users.values())
      .filter(user => user.profile.followings && user.profile.followings.includes(liveRoom.hostId));

    followers.forEach(follower => {
      database.notifications.push({
        id: uuidv4(),
        type: 'live_started',
        title: '直播开始了',
        message: `${liveRoom.hostInfo.nickname} 开始直播：${liveRoom.title}`,
        recipientId: follower.id,
        recipientType: 'user',
        data: { liveRoomId: roomId },
        isRead: false,
        createdAt: new Date()
      });
    });

    res.json({
      success: true,
      message: '直播开始成功',
      data: {
        roomId,
        streamKey,
        streamUrl: liveRoom.streamUrl,
        playUrl: liveRoom.playUrl
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '开始直播失败',
      error: error.message
    });
  }
});

// 结束直播
liveRouter.post('/rooms/:roomId/end', verifyToken, (req, res) => {
  try {
    const { roomId } = req.params;

    if (!database.liveStreams) {
      database.liveStreams = new Map();
    }

    const liveRoom = database.liveStreams.get(roomId);
    if (!liveRoom) {
      return res.status(404).json({
        success: false,
        message: '直播间不存在'
      });
    }

    // 权限检查
    if (liveRoom.hostId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有主播可以结束直播'
      });
    }

    if (liveRoom.status !== 'live') {
      return res.status(400).json({
        success: false,
        message: '直播未在进行中'
      });
    }

    // 结束直播
    liveRoom.status = 'ended';
    liveRoom.endTime = new Date();
    liveRoom.viewers.current = 0;

    // 计算直播时长
    const duration = (liveRoom.endTime - liveRoom.actualStartTime) / 1000 / 60; // 分钟
    liveRoom.duration = Math.round(duration);

    res.json({
      success: true,
      message: '直播结束',
      data: {
        roomId,
        duration: liveRoom.duration,
        stats: liveRoom.stats
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '结束直播失败',
      error: error.message
    });
  }
});

// 推荐商品
liveRouter.post('/rooms/:roomId/recommend-product', verifyToken, (req, res) => {
  try {
    const { roomId } = req.params;
    const { productId, highlightText, specialPrice } = req.body;

    if (!database.liveStreams) {
      database.liveStreams = new Map();
    }

    const liveRoom = database.liveStreams.get(roomId);
    if (!liveRoom) {
      return res.status(404).json({
        success: false,
        message: '直播间不存在'
      });
    }

    // 权限检查
    if (liveRoom.hostId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有主播可以推荐商品'
      });
    }

    const product = database.products.get(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: '商品不存在'
      });
    }

    // 创建推荐记录
    const recommendation = {
      id: uuidv4(),
      liveRoomId: roomId,
      productId,
      productInfo: {
        name: product.name,
        image: product.images[0],
        originalPrice: product.price.selling,
        specialPrice: specialPrice || product.price.selling
      },
      highlightText,
      recommendedAt: new Date(),
      clickCount: 0,
      orderCount: 0
    };

    if (!database.liveProductRecommendations) {
      database.liveProductRecommendations = new Map();
    }
    database.liveProductRecommendations.set(recommendation.id, recommendation);

    res.json({
      success: true,
      message: '商品推荐成功',
      data: recommendation
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '推荐商品失败',
      error: error.message
    });
  }
});

// 获取直播统计
liveRouter.get('/rooms/:roomId/stats', verifyToken, requireRole(['admin']), (req, res) => {
  try {
    const { roomId } = req.params;

    if (!database.liveStreams) {
      database.liveStreams = new Map();
    }

    const liveRoom = database.liveStreams.get(roomId);
    if (!liveRoom) {
      return res.status(404).json({
        success: false,
        message: '直播间不存在'
      });
    }

    // 获取直播期间的订单
    const liveOrders = Array.from(database.orders.values())
      .filter(order => order.liveStreamId === roomId);

    // 获取推荐商品统计
    const recommendations = Array.from(database.liveProductRecommendations?.values() || [])
      .filter(rec => rec.liveRoomId === roomId);

    const stats = {
      basic: liveRoom.stats,
      viewers: liveRoom.viewers,
      duration: liveRoom.duration || 0,
      sales: {
        totalOrders: liveOrders.length,
        totalRevenue: liveOrders.reduce((sum, order) => sum + order.amount.total, 0),
        averageOrderValue: liveOrders.length > 0 ? 
          liveOrders.reduce((sum, order) => sum + order.amount.total, 0) / liveOrders.length : 0
      },
      products: {
        recommendedCount: recommendations.length,
        totalClicks: recommendations.reduce((sum, rec) => sum + rec.clickCount, 0),
        conversionRate: recommendations.length > 0 ? 
          recommendations.reduce((sum, rec) => sum + rec.orderCount, 0) / 
          recommendations.reduce((sum, rec) => sum + rec.clickCount, 0) : 0
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取直播统计失败',
      error: error.message
    });
  }
});

module.exports = liveRouter;
