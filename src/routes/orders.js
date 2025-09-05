const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { database } = require('../utils/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// 创建订单
router.post('/', verifyToken, async (req, res) => {
  try {
    const { 
      items, 
      deliveryAddress, 
      paymentMethod = 'online',
      couponCode,
      orderType = 'online', // online, offline, live
      storeId, // O2O店铺ID
      liveStreamId, // 直播间ID
      notes 
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: '订单商品不能为空'
      });
    }

    // 验证商品库存和价格
    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const product = database.products.get(item.productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          message: `商品 ${item.productId} 不存在`
        });
      }

      if (product.inventory.available < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `商品 ${product.name} 库存不足`
        });
      }

      const itemPrice = req.user.role === 'distributor' ? product.price.distributor :
                       req.user.role === 'retailer' ? product.price.retailer :
                       product.price.selling;

      const itemTotal = itemPrice * item.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        productId: item.productId,
        productName: product.name,
        productImage: product.images[0],
        price: itemPrice,
        quantity: item.quantity,
        total: itemTotal,
        sku: product.sku
      });

      // 预扣库存
      product.inventory.available -= item.quantity;
      product.inventory.reserved += item.quantity;
    }

    // 应用优惠券
    let discountAmount = 0;
    let appliedCoupon = null;
    if (couponCode) {
      const coupon = Array.from(database.coupons.values())
        .find(c => c.code === couponCode && c.status === 'active');
      
      if (coupon && totalAmount >= coupon.minAmount) {
        if (coupon.type === 'percentage') {
          discountAmount = Math.min((totalAmount * coupon.value / 100), coupon.maxDiscount || Infinity);
        } else if (coupon.type === 'fixed') {
          discountAmount = Math.min(coupon.value, totalAmount);
        }
        appliedCoupon = {
          id: coupon.id,
          code: coupon.code,
          name: coupon.name,
          discount: discountAmount
        };
        coupon.usageCount++;
      }
    }

    const finalAmount = totalAmount - discountAmount;

    // 创建订单
    const newOrder = {
      id: uuidv4(),
      orderNo: 'ORD' + Date.now() + Math.floor(Math.random() * 1000),
      userId: req.user.id,
      userInfo: {
        username: req.user.username,
        email: req.user.email
      },
      items: orderItems,
      amount: {
        subtotal: totalAmount,
        discount: discountAmount,
        total: finalAmount,
        shipping: 0
      },
      coupon: appliedCoupon,
      deliveryAddress,
      paymentMethod,
      orderType,
      storeId,
      liveStreamId,
      notes,
      status: 'pending', // pending, paid, shipped, delivered, cancelled, refunded
      paymentStatus: 'unpaid', // unpaid, paid, refunded
      shippingStatus: 'unshipped', // unshipped, shipped, delivered
      timeline: [{
        status: 'created',
        timestamp: new Date(),
        description: '订单创建成功'
      }],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    database.orders.set(newOrder.id, newOrder);

    // 如果是O2O订单，通知店铺
    if (orderType === 'offline' && storeId) {
      // 发送店铺通知
      database.notifications.push({
        id: uuidv4(),
        type: 'new_order',
        title: '新订单提醒',
        message: `收到新的到店订单 ${newOrder.orderNo}`,
        recipientId: storeId,
        recipientType: 'store',
        data: { orderId: newOrder.id },
        isRead: false,
        createdAt: new Date()
      });
    }

    res.status(201).json({
      success: true,
      message: '订单创建成功',
      data: newOrder
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '创建订单失败',
      error: error.message
    });
  }
});

// 获取用户订单列表
router.get('/', verifyToken, (req, res) => {
  try {
    const { page = 1, limit = 10, status, orderType } = req.query;
    
    let orders = Array.from(database.orders.values())
      .filter(order => {
        if (req.user.role === 'admin') return true;
        if (req.user.role === 'supplier') {
          // 供应商只能看到自己商品的订单
          return order.items.some(item => {
            const product = database.products.get(item.productId);
            return product && product.supplierId === req.user.id;
          });
        }
        return order.userId === req.user.id;
      });

    // 状态过滤
    if (status) {
      orders = orders.filter(order => order.status === status);
    }

    // 订单类型过滤
    if (orderType) {
      orders = orders.filter(order => order.orderType === orderType);
    }

    // 排序
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 分页
    const total = orders.length;
    const startIndex = (page - 1) * limit;
    const paginatedOrders = orders.slice(startIndex, startIndex + parseInt(limit));

    res.json({
      success: true,
      data: {
        orders: paginatedOrders,
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
      message: '获取订单列表失败',
      error: error.message
    });
  }
});

// 获取订单详情
router.get('/:orderId', verifyToken, (req, res) => {
  try {
    const { orderId } = req.params;
    const order = database.orders.get(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: '订单不存在'
      });
    }

    // 权限检查
    if (req.user.role !== 'admin' && order.userId !== req.user.id) {
      // 供应商可以查看包含自己商品的订单
      if (req.user.role === 'supplier') {
        const hasSupplierProduct = order.items.some(item => {
          const product = database.products.get(item.productId);
          return product && product.supplierId === req.user.id;
        });
        if (!hasSupplierProduct) {
          return res.status(403).json({
            success: false,
            message: '无权查看此订单'
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          message: '无权查看此订单'
        });
      }
    }

    res.json({
      success: true,
      data: order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取订单详情失败',
      error: error.message
    });
  }
});

// 更新订单状态
router.patch('/:orderId/status', verifyToken, (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, shippingInfo, refundReason } = req.body;

    const order = database.orders.get(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: '订单不存在'
      });
    }

    // 权限检查
    const canUpdate = req.user.role === 'admin' || 
                     (req.user.role === 'supplier' && order.items.some(item => {
                       const product = database.products.get(item.productId);
                       return product && product.supplierId === req.user.id;
                     })) ||
                     (req.user.role === 'customer' && order.userId === req.user.id && status === 'cancelled');

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: '无权更新此订单'
      });
    }

    // 更新订单状态
    const oldStatus = order.status;
    order.status = status;
    order.updatedAt = new Date();

    // 添加时间线记录
    const statusDescriptions = {
      paid: '订单支付成功',
      shipped: '订单已发货',
      delivered: '订单已送达',
      cancelled: '订单已取消',
      refunded: '订单已退款'
    };

    order.timeline.push({
      status,
      timestamp: new Date(),
      description: statusDescriptions[status] || `订单状态更新为${status}`,
      operator: req.user.username
    });

    // 处理库存变化
    if (status === 'cancelled' || status === 'refunded') {
      // 释放库存
      order.items.forEach(item => {
        const product = database.products.get(item.productId);
        if (product) {
          product.inventory.available += item.quantity;
          product.inventory.reserved -= item.quantity;
        }
      });
    } else if (status === 'paid' && oldStatus === 'pending') {
      // 确认库存
      order.items.forEach(item => {
        const product = database.products.get(item.productId);
        if (product) {
          product.inventory.reserved -= item.quantity;
          product.inventory.total -= item.quantity;
        }
      });
    }

    // 处理发货信息
    if (status === 'shipped' && shippingInfo) {
      order.shipping = {
        ...shippingInfo,
        shippedAt: new Date()
      };
      order.shippingStatus = 'shipped';
    }

    // 处理退款原因
    if (status === 'refunded' && refundReason) {
      order.refund = {
        reason: refundReason,
        refundedAt: new Date(),
        operator: req.user.username
      };
    }

    res.json({
      success: true,
      message: '订单状态更新成功',
      data: order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '更新订单状态失败',
      error: error.message
    });
  }
});

// 订单支付
router.post('/:orderId/pay', verifyToken, (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod, paymentData } = req.body;

    const order = database.orders.get(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: '订单不存在'
      });
    }

    if (order.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '无权支付此订单'
      });
    }

    if (order.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: '订单已支付'
      });
    }

    // 模拟支付处理
    order.paymentStatus = 'paid';
    order.status = 'paid';
    order.payment = {
      method: paymentMethod,
      paidAt: new Date(),
      transactionId: 'TXN' + Date.now(),
      amount: order.amount.total
    };

    order.timeline.push({
      status: 'paid',
      timestamp: new Date(),
      description: '订单支付成功'
    });

    // 更新用户积分
    const pointsEarned = Math.floor(order.amount.total * 0.01); // 1%积分
    req.user.profile.points += pointsEarned;

    // 分销佣金计算（三级分销）
    if (req.user.profile.referrerId) {
      const referrer = database.users.get(req.user.profile.referrerId);
      if (referrer) {
        const level1Commission = order.amount.total * 0.05; // 5%
        referrer.profile.wallet += level1Commission;
        
        // 二级分销
        if (referrer.profile.referrerId) {
          const level2Referrer = database.users.get(referrer.profile.referrerId);
          if (level2Referrer) {
            const level2Commission = order.amount.total * 0.03; // 3%
            level2Referrer.profile.wallet += level2Commission;
            
            // 三级分销
            if (level2Referrer.profile.referrerId) {
              const level3Referrer = database.users.get(level2Referrer.profile.referrerId);
              if (level3Referrer) {
                const level3Commission = order.amount.total * 0.01; // 1%
                level3Referrer.profile.wallet += level3Commission;
              }
            }
          }
        }
      }
    }

    res.json({
      success: true,
      message: '支付成功',
      data: {
        order,
        pointsEarned
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '支付失败',
      error: error.message
    });
  }
});

// O2O核销订单
router.post('/:orderId/verify', verifyToken, requireRole(['admin', 'retailer']), (req, res) => {
  try {
    const { orderId } = req.params;
    const { verificationCode } = req.body;

    const order = database.orders.get(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: '订单不存在'
      });
    }

    if (order.orderType !== 'offline') {
      return res.status(400).json({
        success: false,
        message: '此订单不支持核销'
      });
    }

    if (order.status === 'delivered') {
      return res.status(400).json({
        success: false,
        message: '订单已核销'
      });
    }

    // 验证核销码（简单实现）
    const expectedCode = order.id.slice(-6).toUpperCase();
    if (verificationCode !== expectedCode) {
      return res.status(400).json({
        success: false,
        message: '核销码错误'
      });
    }

    // 核销订单
    order.status = 'delivered';
    order.verification = {
      verifiedBy: req.user.id,
      verifiedAt: new Date(),
      verificationCode
    };

    order.timeline.push({
      status: 'delivered',
      timestamp: new Date(),
      description: `订单已核销，操作员：${req.user.username}`
    });

    res.json({
      success: true,
      message: '核销成功',
      data: order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '核销失败',
      error: error.message
    });
  }
});

// 获取订单统计
router.get('/stats/overview', verifyToken, requireRole(['admin', 'supplier']), (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let orders = Array.from(database.orders.values());

    // 供应商只能看自己商品的订单
    if (req.user.role === 'supplier') {
      orders = orders.filter(order => 
        order.items.some(item => {
          const product = database.products.get(item.productId);
          return product && product.supplierId === req.user.id;
        })
      );
    }

    // 日期过滤
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      orders = orders.filter(order => {
        const orderDate = new Date(order.createdAt);
        return orderDate >= start && orderDate <= end;
      });
    }

    // 计算统计数据
    const stats = {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, order) => sum + order.amount.total, 0),
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      paidOrders: orders.filter(o => o.status === 'paid').length,
      shippedOrders: orders.filter(o => o.status === 'shipped').length,
      deliveredOrders: orders.filter(o => o.status === 'delivered').length,
      cancelledOrders: orders.filter(o => o.status === 'cancelled').length,
      onlineOrders: orders.filter(o => o.orderType === 'online').length,
      offlineOrders: orders.filter(o => o.orderType === 'offline').length,
      liveOrders: orders.filter(o => o.orderType === 'live').length,
      averageOrderValue: orders.length > 0 ? 
        orders.reduce((sum, order) => sum + order.amount.total, 0) / orders.length : 0
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取订单统计失败',
      error: error.message
    });
  }
});

module.exports = router;
