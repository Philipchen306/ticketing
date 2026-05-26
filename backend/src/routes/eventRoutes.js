const express = require("express");
const router = express.Router();

const eventService = require("../services/eventService");

router.post("/init-db", async (req, res) => {
    try {
        const result = await eventService.initDb();
        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }
}) ;

router.post("/", async (req, res) => {
    try {
        const result = await eventService.createEvent(req.body);
        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }  
});

router.get("/", async (req, res) => {
    try {
        const result = await eventService.getEvents();
        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }  
});

router.get("/:id/availability", async (req, res) => {
    try {
        const result = await eventService.getAvailability(req.params.id);
        res.json(result);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message});
    }  
});

module.exports = router;