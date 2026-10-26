'use strict';

const express = require('express');
const router = express.Router();
const packageJson = require('../../package.json');

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    ...(process.env.COMMUNITY_STANDALONE_RUNTIME === '1' ? { mode: 'standalone', instanceId: process.env.COMMUNITY_BACKEND_INSTANCE_ID || '' } : {}),
    service: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
