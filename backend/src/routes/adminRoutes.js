'use strict';

const express = require('express');
const router = express.Router();
const adminService = require('../services/adminService');
const { authRequired, adminRequired } = require('../middleware/auth');

router.get('/overview', authRequired, adminRequired, (_req, res) => {
  res.json(adminService.getOverview());
});

module.exports = router;
