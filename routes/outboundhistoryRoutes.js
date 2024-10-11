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
                ob.date,
                ob.client,
                ob.total_quantity,
                ob.handler_name,
                ob.warehouse_name,
                ob.warehouse_shelf,
                ob.description
            FROM
                outbound ob
            INNER JOIN
                items i ON i.id = ob.item_id
            ORDER BY
                ob.date DESC
        `);

        if (outboundhistory.length === 0) {
            res.json({ message: "출고 이력이 없습니다." });
        } else {
            res.json(outboundhistory);
        }
    } catch (error) {
        console.log('Error fetching outbound history:', error);
        res.status(500).json({ error: '출고 이력을 가져오는 중 오류가 발생했습니다.' });
    }
});

module.exports = router;