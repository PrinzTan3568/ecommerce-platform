const database = {
  users: new Map(),
  products: new Map(), 
  orders: new Map(),
  stores: new Map(),
  coupons: new Map(),
  liveStreams: new Map(),
  notifications: []
};

// 演示数据初始化
function initDatabase() {
  // 创建管理员
  database.users.set('admin1', {
    id: 'admin1',
    username: 'admin',
    email: 'admin@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/iEEZGkLf8pHcU7/pO', // admin123
    role: 'admin',
    profile: {
      nickname: '系统管理员',
      avatar: '',
      memberLevel: 4,
      points: 0,
      wallet: 0
    },
    status: 'active',
    createdAt: new Date()
  });

  // 创建供应商
  database.users.set('supplier1', {
    id: 'supplier1', 
    username: 'supplier1',
    email: 'supplier@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/iEEZGkLf8pHcU7/pO',
    role: 'supplier',
    profile: {
      nickname: '优质供应商',
      memberLevel: 3,
      points: 0,
      wallet: 5000
    },
    status: 'active',
    createdAt: new Date()
  });

  // 创建演示商品
  database.products.set('prod1', {
    id: 'prod1',
    name: 'iPhone 15 Pro Max',
    description: '最新款苹果手机，配备A17 Pro芯片，钛金属机身',
    category: '电子产品',
    brand: 'Apple',
    sku: 'IP15PM256',
    images: ['/images/iphone15.jpg'],
    price: {
      original: 9999,
      selling: 8999,
      distributor: 8500,
      retailer: 8800
    },
    inventory: {
      total: 100,
      available: 95,
      reserved: 5,
      threshold: 10
    },
    attributes: {
      color: '深空灰',
      storage: '256GB',
      network: '5G'
    },
    tags: ['新品', '热销', '5G', 'Apple'],
    status: 'active',
    supplierId: 'supplier1',
    createdAt: new Date()
  });

  database.products.set('prod2', {
    id: 'prod2',
    name: '小米13 Ultra',
    description: '徕卡影像旗舰，专业摄影体验',
    category: '电子产品',
    brand: '小米',
    sku: 'MI13U512',
    images: ['/images/mi13ultra.jpg'],
    price: {
      original: 5999,
      selling: 5499,
      distributor: 5200,
      retailer: 5400
    },
    inventory: {
      total: 80,
      available: 78,
      reserved: 2,
      threshold: 15
    },
    attributes: {
      color: '陶瓷黑',
      storage: '512GB',
      camera: '徕卡三摄'
    },
    tags: ['摄影', '旗舰', '徕卡'],
    status: 'active',
    supplierId: 'supplier1',
    createdAt: new Date()
  });

  // 创建优惠券
  database.coupons.set('coupon1', {
    id: 'coupon1',
    name: '新用户专享',
    code: 'NEWUSER10',
    type: 'percentage',
    value: 10,
    minAmount: 100,
    maxDiscount: 50,
    maxUsage: 1000,
    usageCount: 0,
    status: 'active',
    validFrom: new Date(),
    validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date()
  });

  console.log('✅ 数据库初始化完成');
}

module.exports = { database, initDatabase };
