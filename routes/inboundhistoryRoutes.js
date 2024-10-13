const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    const { startDate, endDate } = req.query;
    const queryParams = [];

    let query = `
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
        INNER JOIN
            inbound ib ON i.id = ib.item_id
        WHERE 1=1
    `;

    if (startDate && endDate) {
        query += ` AND ib.date BETWEEN $1 AND $2`;
        queryParams.push(startDate, endDate);
    } else {
        // 기본적으로 최근 6개월 데이터를 가져오도록 설정
        query += ` AND ib.date >= (CURRENT_DATE - INTERVAL '6 months')`;
    }

    query += ` ORDER BY ib.date DESC`;

    try {
        const inboundhistory = await db.query(query, queryParams);
        res.json(inboundhistory);
    } catch (error) {
        console.error('Error fetching inboundhistory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;