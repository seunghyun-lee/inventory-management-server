const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const inboundhistory = await db.all(`
            SELECT
                i.id, 
                i.manufacturer, 
                i.item_name, 
                i.item_subname, 
                ib.date,
                ib.supplier,
                ib.total_quantity,
                ib.handler_name,
                ib.warehouse_name,
                ib.warehouse_shelf,
                ib.description
            FROM
                items i
            LEFT JOIN
                inbound ib ON i.id = ib.item_id
            `);
        res.json(inboundhistory);
    } catch (error) {
        console.log('Error fetching inboundhistory:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;