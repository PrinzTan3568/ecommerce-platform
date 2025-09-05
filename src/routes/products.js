const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { database } = require('../utils/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// 获取商品列表
router.get('/', (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      category, 
      brand, 
      search, 
      status = 'active',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let products = Array.from(database.products.values());