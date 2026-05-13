const express = require("express");
const mysql = require("mysql2/promise");
const { createClient } = require("redis");

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
      status ENUM('available', 'reserved', 'sold') DEFAULT 'available',
      user_id VARCHAR(255),
      reserved_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id)
    )`);

    res.json({ message: "Database initialized" });
});

app.post("/seed", async (req, res) => {
    const [eventResult] = await db.execute(
        "Insert into events (name, venue, event_time) values (?, ?, ?)",
        ["Twice", "Taipei Dome", "2026-08-01 19:30:00"]
    );

    const eventId = eventResult.insertId;
    
    for (let i =0; i<100; i++) {
        await db.execute(
            "Insert into tickets (event_id, status) values (?, 'available')",
            [eventId]
        );
    }

    res.json({ message: "Seed data created", eventId });
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

app.post("/events/:id/book", async (req, res) => {
    const eventId = req.params.id;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required"});
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
            `SELECT id
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

        const ticketId = tickets[0].id;

        await connection.execute(
            `UPDATE tickets
            SET status = 'sold', user_id = ?
            WHERE id = ?`,
            [userId, ticketId]
        );

        await connection.commit();

        res.json({
            message: "Ticket booked successfully",
            ticketId
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

app.post("/events/:id/queue/join", async(req, res) => {
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
        messagee: "Joined queue",
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

init().then(() => {
  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });
});