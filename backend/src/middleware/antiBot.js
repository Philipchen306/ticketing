const redisClient = require("../config/redis");

async function antiBot(req, res, next) {
    const userId = req.body.userId || req.params.userId || "anonymous";
    const ip = req.headers["x-forwarded-for"] || req.ip;
    const userAgent = req.headers["user-agent"] || "unknown";
    const deviceId = req.headers["x-device-id"] || "unknown";

    let riskScore = 0;

    // IP requeest count
    const ipKey = `rate:ip:${ip}`;
    const ipCount = await redisClient.incr(ipKey);
    if (ipCount === 1) await redisClient.expire(ipKey, 10);
    if (ipCount > 20) riskScore += 30;

    // User request count
    const userKey = `rate:user:${userId}`;
    const userCount = await redisClient.incr(userKey);
    if (userCount === 1) await redisClient.expire(userKey, 10);
    if (userCount > 5) riskScore += 30;

    // Device fingerprint
    const fingerprint = `${userAgent}:${deviceId}`;
    const fpKey = `fingerprint:${userId}`;
    const existingFp = await redisClient.get(fpKey);

    if (!existingFp) {
        await redisClient.set(fpKey, fingerprint, {EX: 3600});
    } else if (existingFp !== fingerprint) {
        riskScore += 20;
    }

    // Session age
    const sessionKey = `session_start:${userId}`;
    const sessionStart = await redisClient.get(sessionKey);

    if (!sessionStart) {
        await redisClient.set(sessionKey, Date.now().toString(), { EX: 3600 });
    } else {
        const ageMs = Date.now() - Number(sessionStart);
        if (ageMs < 2000) riskScore += 10;
    }

    if (riskScore >= 60) {
        return res.status(429).json({
        error: "Request blocked due to suspicious behavior",
        riskScore
        });
    }

    req.riskScore = riskScore;
    next();
}

module.exports = antiBot;