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
            ob.date,
            ob.client,
            ob.total_quantity,
            ob.handler_name,
            ob.warehouse_name,
            ob.warehouse_shelf,
            ob.description
        FROM
            items i
        INNER JOIN
            outbound ob ON i.id = ob.item_id
        WHERE 1=1
    `;

    if (startDate && endDate) {
        query += ` AND ob.date BETWEEN $1 AND $2`;
        queryParams.push(startDate, endDate);
    } else {
        // 기본적으로 최근 6개월 데이터를 가져오도록 설정
        query += ` AND ob.date >= (CURRENT_DATE - INTERVAL '6 months')`;
    }

    query += ` ORDER BY ob.date DESC`;

    try {
        const outboundhistory = await db.query(query, queryParams);
        res.json(outboundhistory);
    } catch (error) {
        console.error('Error fetching outboundhistory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;