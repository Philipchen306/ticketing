const redisClient = require("../config/redis");
const crypto = require("crypto");

async function joinQueue(eventId, userId) {
    if (!userId) {
        const err = new Erorr("userId is required")
        err.statusCode = 400;
        throw err;
    }

    const queueKey = `queue:event:${eventId}`;
    const score = Date.now();

    await redisClient.zAdd(queueKey, [
        {
            score,
            value: userId
        }
    ]);

    const rank = await redisClient.zRank(queueKey, userId);

    return {
        message: "Joined queue",
        eventId,
        userId, 
        position: rank + 1
    };
};

async function getQueuePosition(eventId, userId) {
    const queueKey = `queue:event:${eventId}`;

    const rank = await redisClient.zRank(queueKey, userId);

    if (rank == null) {
        const err = new Error("User not in queue");
        err.statusCode = 400;
        throw err;
    }

    return {
        eventId,
        userId,
        position: rank + 1
    };
}


async function admitQueue(eventId, limit = 1) {
    const queueKey = `queue:event:${eventId}`;
    const users = await redisClient.zRange(queueKey, 0, limit - 1);

    if (users.length === 0) {
        const err = new Error("Queue is empty");
        err.statusCode = 404;
        throw err;
    }

    const admittedUsers = [];

    for (const userId of users) {
        const token = crypto.randomBytes(16).toString("hex");
        const tokenKey = `booking_token:${eventId}:${userId}`;

        await redisClient.set(tokenKey, token, {
            EX: 60 
        });

        await redisClient.zRem(queueKey, userId);

        admittedUsers.push({
            userId,
            bookingToken: token,
            expiresInSeconds: 60 
        });
    }
    return {
        message: "Users admitted",
        eventId,
        admittedUsers
    };
};

module.exports = {
    joinQueue,
    getQueuePosition,
    admitQueue
}