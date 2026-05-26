const db = require("../config/db");

async function initDb() {
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

    return { message: "Database initialized" };
};

async function createEvent(data) {
    const {
        name, 
        venue, 
        eventTime,
        ticketCount
    } = data;
    const parsedTicketCount = parseInt(ticketCount);

    if (!name || !venue || !eventTime || !parsedTicketCount || isNaN(parsedTicketCount)) {
        const err = new Error("Missing or invalid required fields");
        err.statusCode = 400;
        throw err;
    }
    const [eventResult] = await db.execute(
        `INSERT INTO events (name, venue, event_time)
        VALUES (?, ?, ?)`,
        [name, venue, eventTime]
    );

     const eventId = eventResult.insertId;

    for (let i = 1; i <= parsedTicketCount; i++) {
        await db.execute(
        `INSERT INTO tickets
        (event_id, seat_number, status)
        VALUES (?, ?, 'available')`,
        [eventId, `A-${i}`]
        );
    }

    return {
        message: "Event created successfully",
        eventId,
        ticketCount: parsedTicketCount
    };
};

async function getEvents() {
    const [rows] = await db.execute("Select * From events");
    return rows;
};

async function getAvailability(eventId) {
    const [rows] = await db.execute(
        `Select status, count(*) as count
        from tickets
        where event_id = ?
        group by status
        `,
        [eventId]
    );

    return rows;
}

module.exports = {
    initDb,
    createEvent,
    getEvents,
    getAvailability
};
    
