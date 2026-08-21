'use strict';

const express = require('express');
const router = express.Router();
const packageJson = require('../../package.json');

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
