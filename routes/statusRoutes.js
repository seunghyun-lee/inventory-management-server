const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/status', async (req, res) => {
    try {
        const dbStatus = await db.checkConnection();
        res.json({
            server: {
                status: 'running',
                environment: process.env.NODE_ENV || 'development',
                timestamp: new Date().toISOString()
            },
            database: dbStatus
        });
    } catch (error) {
        res.status(500).json({
            server: {
                status: 'error',
                environment: process.env.NODE_ENV || 'development',
                timestamp: new Date().toISOString()
            },
            error: error.message
        });
    }
});

module.exports = router;