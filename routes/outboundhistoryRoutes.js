const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const outboundhistory = await db.all(`
            SELECT
                i.id, 
                i.manufacturer, 
                i.item_name, 
                i.item_subname, 
                ib.date,
                ib.client,
                ib.total_quantity,
                ib.handler_name,
                ib.warehouse_name,
                ib.description
            FROM
                items i
            LEFT JOIN
                outbound ib ON i.id = ib.item_id
            `);
        res.json(outboundhistory);
    } catch (error) {
        console.log('Error fetching outboundhistory:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;