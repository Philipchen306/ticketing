const express = require("express");
const router = express.Router();

const bookingService = require("../services/bookingService");
const rateLimiter = require("../middleware/rateLimiter");
const antiBot = require("../middleware/antiBot");

router.post("/:id/book", rateLimiter, antiBot, async (req, res) => {
    try {
        const result = await bookingService.bookEvent(
            req.params.id,
            req.body.userId,
            req.body.bookingToken
        );

        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }
});

router.post("/:id/booking/confirm", async (req, res) => {
    try {
        const result = await bookingService.confirmBooking(
            req.params.id,
            req.body.userId,
            req.body.ticketId
        );

        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }
});

module.exports = router;