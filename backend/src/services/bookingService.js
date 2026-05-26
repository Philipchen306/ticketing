const redisClient = require("../config/redis");
const db = require("../config/db");
const crypto = require("crypto");

async function bookEvent(eventId, userId, bookingToken) {
    if (!userId || !bookingToken) {
        const err = new Error("userId and bookingToken is required");
        err.statusCode = 400;
        throw err;
    }

    const tokenKey = `booking_token:${eventId}:${userId}`;
    const storedToken = await redisClient.get(tokenKey);

    if (!storedToken || storedToken !== bookingToken) {
        const err = new Error("Invalid or expired booking token");
        err.statusCode = 403;
        throw err;
    }

    const connection = await db.getConnection();

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
            const err = new Error("No tickets available");
            err.statusCode = 409;
            throw err; 
        }
        const ticket = tickets[0];

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

        return {
            message: "Ticket booked successfully",
            ticketId: ticket.id,
            seatNumber: ticket.seat_number,
            reservedBy: userId
        };

    } catch (err) {
        await connection.rollback();

        throw err;
    } finally {
        await connection.release();
    }
};

async function confirmBooking(eventId, userId, ticketId) {
    if (!userId || !ticketId) {
        const err = new Error("userId and ticketId are required");
        err.statusCode = 400;
        throw err;
    }

    const connection = await db.getConnection();

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
            const err = new Error("Ticket not found");
            err.statusCode = 404;
            throw err;
        }

        const ticket = tickets[0];

        if (ticket.status !== "reserved" || ticket.reserved_by !== userId) {
            await connection.rollback();
            
            const err = new Error("Ticket is not reserved by the user");
            err.statusCode = 409;
            throw err;
        }

        await connection.execute(
            `UPDATE tickets
            SET status = 'sold',
                sold_at = NOW()
            WHERE id = ?`,
            [ticketId]
        );

        await connection.commit();

        return {
            message: "Booking confirmed successfully",
            ticketId,
            userId
        };

    } catch (err) {
        await connection.rollback();
        throw err;

    } finally {
        await connection.release();
    }
};

module.exports = {
    bookEvent,
    confirmBooking,   
};
