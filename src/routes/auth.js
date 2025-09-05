const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { database } = require('../utils/database');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role = 'customer' } = req.body;

    // 验证必填字段
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名、邮箱和密码都是必填的'
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

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 12);

    // 创建新用户
    const newUser = {
      id: uuidv4(),
      username,
      email,
      password: hashedPassword,
      role,
      profile: {
        nickname: username,
        avatar: '',
        memberLevel: role === 'customer' ? 1 : 2,
        points: role === 'customer' ? 100 : 0, // 新用户奖励
        wallet: 0
      },
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    database.users.set(newUser.id, newUser);

    // 生成token
    const token = generateToken(newUser);

    // 返回结果（不返回密码）
    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: {
        user: userWithoutPassword,
        token
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '注册失败',
      error: error.message
    });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '请提供用户名和密码'
      });
    }

    // 查找用户
    const user = Array.from(database.users.values())
      .find(u => u.username === username || u.email === username);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 检查账户状态
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: '账户已被禁用'
      });
    }

    // 生成token
    const token = generateToken(user);

    // 更新最后登录时间
    user.lastLoginAt = new Date();

    // 返回结果（不返回密码）
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: '登录成功',
      data: {
        user: userWithoutPassword,
        token
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '登录失败',
      error: error.message
    });
  }
});

// 获取当前用户信息
router.get('/me', require('../middleware/auth').verifyToken, (req, res) => {
  const { password, ...userWithoutPassword } = req.user;
  
  res.json({
    success: true,
    data: userWithoutPassword
  });
});

// 演示用户登录（无需密码验证）
router.post('/demo-login', (req, res) => {
  const { role = 'customer' } = req.body;
  
  // 根据角色返回对应的演示用户
  let demoUser;
  switch (role) {
    case 'admin':
      demoUser = database.users.get('admin1');
      break;
    case 'supplier':
      demoUser = database.users.get('supplier1');
      break;
    default:
      // 创建临时客户用户
      demoUser = {
        id: 'demo_customer',
        username: 'demo_customer',
        email: 'demo@example.com',
        role: 'customer',
        profile: {
          nickname: '演示用户',
          memberLevel: 1,
          points: 500,
          wallet: 1000
        },
        status: 'active',
        createdAt: new Date()
      };
      database.users.set(demoUser.id, demoUser);
  }

  const token = generateToken(demoUser);
  const { password, ...userWithoutPassword } = demoUser;

  res.json({
    success: true,
    message: '演示登录成功',
    data: {
      user: userWithoutPassword,
      token
    }
  });
});

module.exports = router;