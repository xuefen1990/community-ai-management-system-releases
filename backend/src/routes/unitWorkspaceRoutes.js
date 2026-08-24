'use strict';

const express = require('express');
const workspace = require('../services/unitWorkspaceService');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/data', authRequired, (req, res, next) => { try { res.json(workspace.read(req.user)); } catch (error) { next(error); } });
router.put('/data', authRequired, (req, res, next) => { try { res.json(workspace.write(req.user, req.body)); } catch (error) { next(error); } });
router.get('/events', authRequired, (req, res, next) => {
  try {
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.flushHeaders?.(); res.write('event: ready\ndata: {}\n\n');
    const unsubscribe = workspace.subscribe(req.user, payload => res.write(`event: changed\ndata: ${JSON.stringify(payload)}\n\n`));
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
  } catch (error) { next(error); }
});

module.exports = router;
