const mysql = require("mysql2/promise");

const db = mysql.createPool({
    host: "localhost",
    port: 3307,
    user: "root",
    password: "password",
    database: "ticket_system",
    waitForConnections: true,
    connectionLimit: 10
  });

  module.exports = db;