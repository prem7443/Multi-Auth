// routes/index.routes.js
const express = require("express");
const router = express.Router();
const authRoutes = require("./auth.routes");
const sendResponse = require("../utils/responseHandler");
const { pool } = require("../config/db");

// Basic liveness route (kept for backward compatibility)
router.get("/", (req, res) => {
  return sendResponse(res, 200, true, "System Works");
});

// Health check route - verifies app AND database connectivity.
// Jenkins pipeline polls this after every deploy before deciding rollback.
router.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({
      status: "healthy",
      app: "up",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      status: "unhealthy",
      app: "up",
      database: "disconnected",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Register auth routes
router.use("/auth", authRoutes);

// 404 Routes
router.use((req, res) => {
  return sendResponse(res, 404, false, "Route not found");
});

module.exports = router;
