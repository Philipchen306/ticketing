const express = require("express");

const eventRoutes = require("./routes/eventRoutes");
const queueRoutes = require("./routes/queueRoutes");
const bookingRoutes = require("./routes/bookingRoutes");

const app = express();
app.use(express.json());

app.use("/events", eventRoutes);
app.use("/events", queueRoutes);
app.use("/events", bookingRoutes);

module.exports = app;

