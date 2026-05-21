const express = require("express");
const mysql = require("mysql2/promise");
const { createClient } = require("redis");
const crypto = require("crypto");

const app = express();
app.use(express.json());

let db;
let redisClient;

// Initialize DB & Redis
async function init() {
  db = await mysql.createConnection({
    host: "localhost",
    port: 3307,
    user: "root",
    password: "password",
    database: "ticket_system"
  });

  redisClient = createClient();
  await redisClient.connect();

  console.log("Connected to MySQL & Redis");
}

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

// Test -------------------------------
app.get("/health", async (req, res) => {
  res.send("OK");
});

app.get("/test-db", async (req, res) => {
  const [rows] = await db.execute("SELECT 1");
  res.json(rows);
});

app.get("/test-redis", async (req, res) => {
  await redisClient.set("test", "hello");
  const value = await redisClient.get("test");
  res.json({ value });
});

// -------------------------------
app.post("/init-db", async (req, res) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      venue VARCHAR(255) NOT NULL,
      event_time DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await db.execute(` 
      CREATE TABLE IF NOT EXISTS tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_id INT NOT NULL,
      seat_number varchar(50),
      status ENUM('available', 'reserved', 'sold') DEFAULT 'available',
      reserved_by VARCHAR(255),
      reserved_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      sold_at TIMESTAMP NULL,
      FOREIGN KEY (event_id) REFERENCES events(id)
    )`);

    res.json({ message: "Database initialized" });
});

app.post("/events", async (req, res) => {
    const {
        name, 
        venue, 
        eventTime,
        ticketCount
    } = req.body;

    if (!name || !venue || !eventTime || !ticketCount) {
        return res.status(400).json({
            error: "Missing required fields"
        });
    }
    const [eventResult] = await db.execute(
        `INSERT INTO events (name, venue, event_time)
        VALUES (?, ?, ?)`,
        [name, venue, eventTime]
    );

     const eventId = eventResult.insertId;

    for (let i = 1; i <= ticketCount; i++) {
        await db.execute(
        `INSERT INTO tickets
        (event_id, seat_number, status)
        VALUES (?, ?, 'available')`,
        [eventId, `A-${i}`]
        );
    }

    res.json({
        message: "Event created successfully",
        eventId,
        ticketCount
    });
});

app.get("/events", async (req, res) => {
    const [rows] = await db.execute("Select * From events");
    res.json(rows);
});

app.get("/events/:id/availability", async (req, res) => {
    const [rows] = await db.execute(
        `Select status, count(*) as count
        from tickets
        where event_id = ?
        group by status
        `,
        [req.params.id]
    );

    res.json(rows);
});

app.post("/events/:id/book", rateLimiter, antiBot, async (req, res) => {
    const eventId = req.params.id;
    const { userId, bookingToken } = req.body;

    if (!userId || !bookingToken) {
        return res.status(400).json({ error: "userId and bookingToken is required"});
    }
    const tokenKey = `booking_token:${eventId}:${userId}`;
    const storedToken = await redisClient.get(tokenKey);

    if (!storedToken || storedToken !== bookingToken) {
        return res.status(403).json({
            error: "Invalid or expired booking token"
        });
    }

    const connection = await mysql.createConnection({
        host: "localhost",
        port: 3307,
        user: "root",
        password: "password",
        database: "ticket_system"
    });

    try {
        await connection.beginTransaction();

        const [tickets] = await connection.execute(
            `SELECT id, seat_number
            FROM tickets
            WHERE event_id = ? AND status = 'available'
            LIMIT 1
            FOR UPDATE`,
            [eventId]
        );
        if (tickets.length == 0) {
            await connection.rollback();

            return res.status(409).json({
                error: "No tickets available"
            });
        }
        const ticket = tickets[0];
        // const ticketId = tickets[0].id;

        await connection.execute(
            `UPDATE tickets
            SET status = 'reserved', 
                reserved_by = ?,
                reserved_at = NOW()
            WHERE id = ?`,
            [userId, ticket.id]
        );

        await connection.commit();
        await redisClient.del(tokenKey);

        res.json({
            message: "Ticket booked successfully",
            ticketId: ticket.id,
            seatNumber: ticket.seat_number,
            reservedBy: userId
        });
    } catch (err) {
        await connection.rollback();

        res.status(500).json({
            error: err.message
        });
    } finally {
        await connection.end();
    }
});

app.post("/events/:id/queue/join", rateLimiter, antiBot,  async(req, res) => {
    const eventId = req.params.id;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required"});
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

    res.json({
        message: "Joined queue",
        eventId,
        userId, 
        position: rank + 1
    });
});

app.get("/events/:id/queue/position/:userId", async (req, res) => {
    const {id: eventId, userId} = req.params;
    const queueKey = `queue:event:${eventId}`;

    const rank = await redisClient.zRank(queueKey, userId);

    if (rank == null) {
        return res.status(404).json({ error: "User not in queue"});
    }

    res.json({
        eventId,
        userId,
        position: rank + 1
    });
})


app.post("/events/:id/queue/admit", async (req, res) => {
    const eventId = req.params.id;
    const { limit = 1 } = req.body;

    const queueKey = `queue:event:${eventId}`;
    const users = await redisClient.zRange(queueKey, 0, limit - 1);

    if (users.length === 0) {
        return res.status(404).json({ error: "Queue is empty"});
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
    res.json({
        message: "Users admitted",
        eventId,
        admittedUsers
    });
});

app.post("/events/:id/booking/confirm", async (req, res) => {
    const eventId = req.params.id;
    const { userId, ticketId } = req.body;
    
    if (!userId || !ticketId) {
        return res.status(400).json({ error: "userId and ticketId are required"}); 
    }

    const connection = await mysql.createConnection({
        host: "localhost",
        port: 3307,
        user: "root",
        password: "password",
        database: "ticket_system"
    });

    try {
        await connection.beginTransaction();

        const [tickets] = await connection.execute(
            `SELECT id, status, reserved_by
            FROM tickets
            WHERE id = ? AND event_id = ?
            FOR UPDATE`, 
            [ticketId, eventId]
        );
        if (tickets.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Ticket not found"});
        }

        const ticket = tickets[0];

        if (ticket.status !== "reserved" || ticket.reserved_by !== userId) {
            await connection.rollback();
            return res.status(409).json({
                error: "Ticket is not reserved by the user"
            });
        }

        await connection.execute(
            `UPDATE tickets
            SET status = 'sold',
                sold_at = NOW()
            WHERE id = ?`,
            [ticketId]
        );

        await connection.commit();

        res.json({
            message: "Booking confirmed successfully",
            ticketId,
            userId
        });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        await connection.end();
    }
})



init().then(() => {
    // app.use(rateLimiter);

    app.listen(3000, () => {
    console.log("Server running on port 3000");
  });
});