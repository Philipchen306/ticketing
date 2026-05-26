const redisClient = require("../config/redis");

async function rateLimiter(req, res, next) {
    const ip = req.headers["x-forwarded-for"] || req.ip;
    const now = Date.now();
    const windowMs = 10000; // 10 sec
    const maxRequests = 200;

    const key = `rate_limit:${ip}`;

    await redisClient.zRemRangeByScore(key, 0, now - windowMs);

    await redisClient.zAdd(key, [{ score: now, value: `${now}-${Math.random()}`}]);
    await redisClient.expire(key, Math.ceil(windowMs / 1000));

    const count = await redisClient.zCard(key);

    if (count > maxRequests) {
        return res.status(429).json({ error: "Too many requests", count});
    }
    next();
}

module.exports = rateLimiter;
