'use strict';

const express = require('express');
const router = express.Router();
const adminService = require('../services/adminService');
const { authRequired, adminRequired } = require('../middleware/auth');
const accounts = require('../services/adminAccountDirectory');

router.get('/accounts', authRequired, adminRequired, (req,res,next)=>{
  try { res.json(accounts.list(req.query)); } catch(error) { next(error); }
});
router.get('/accounts/:accountId', authRequired, adminRequired, (req,res,next)=>{
  try { res.json(accounts.detail(req.params.accountId,req.query)); } catch(error) { next(error); }
});

router.get('/overview', authRequired, adminRequired, (_req, res) => {
  res.json(adminService.getOverview());
});

module.exports = router;
