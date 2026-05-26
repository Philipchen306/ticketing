const { createClient } = require("redis");

const redisClient = createClient();

redisClient.connect()
    .then(() => console.log("Connected to Redis"))
    .catch(err => console.error("Redis connection error:", err));

    module.exports  = redisClient;