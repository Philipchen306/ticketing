const express = require("express");
const router = express.Router();

const queueService = require("../services/queueService");
const rateLimiter = require("../middleware/rateLimiter");
const antiBot = require("../middleware/antiBot");

router.post("/:id/queue/join", rateLimiter, antiBot, async (req, res) => {
    try {
        const result = await queueService.joinQueue(
            req.params.id,
            req.body.userId
        );

        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }
});

router.get("/:id/queue/position/:userId", async (req, res) => {
    try {
        const result = await queueService.getQueuePosition(
            req.params.id,
            req.body.userId
        );

        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }
});

router.post("/:id/queue/admit", async (req, res) => {
    try {
        const result = await queueService.admitQueue(
            req.params.id,
            req.body.limit || 1
        );

        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }
});

module.exports = router;