const express = require('express');
const router = express.Router();
const db = require('../db');

// 한국 시간대로 날짜를 변환하는 유틸리티 함수
function toKSTDate(date) {
    // 날짜 문자열이 들어오면 Date 객체로 변환
    const inputDate = new Date(date);
    // 한국 시간대로 설정
    const kstDate = new Date(inputDate.getTime() + (9 * 60 * 60 * 1000));
    // 시간을 00:00:00으로 설정하여 날짜만 반환
    return new Date(kstDate.getFullYear(), kstDate.getMonth(), kstDate.getDate());
}

router.post('/inbound', async (req, res) => {
    const { 
        manufacturer, 
        item_name, 
        item_subname, 
        item_subno,
        date,  // 클라이언트에서 받은 날짜
        supplier, 
        total_quantity, 
        handler_name, 
        warehouse_name, 
        warehouse_shelf, 
        description 
    } = req.body;

    // 입력 데이터 유효성 검사
    if (!manufacturer || !item_name || !date || !supplier || !total_quantity || !handler_name || !warehouse_name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // 날짜를 한국 시간대로 변환
    const kstDate = toKSTDate(date);

    try {
        await db.runTransaction(async (dbTransaction) => {
            // 먼저 items 테이블에서 품목을 찾거나 새로 추가합니다.
            let item = await db.get(
                `SELECT id FROM items 
                 WHERE manufacturer = $1 
                 AND item_name = $2 
                 AND COALESCE(item_subname, '') = COALESCE($3, '')
                 AND COALESCE(item_subno, '') = COALESCE($4, '')`,
                [manufacturer, item_name, item_subname, item_subno]
            );
        
            if (!item) {
                const result = await db.run(
                    'INSERT INTO items (manufacturer, item_name, item_subname, item_subno) VALUES ($1, $2, $3, $4) RETURNING id', 
                    [manufacturer, item_name, item_subname, item_subno]
                );
                item = { id: result.id };
            }

            // 입고 트랜잭션 생성 - 변환된 KST 날짜 사용
            await db.run(`
                INSERT INTO inbound (
                    item_id, 
                    date, 
                    supplier, 
                    total_quantity, 
                    handler_name, 
                    warehouse_name, 
                    warehouse_shelf, 
                    description
                ) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                item.id, 
                kstDate,  // 변환된 KST 날짜 사용
                supplier, 
                total_quantity, 
                handler_name, 
                warehouse_name, 
                warehouse_shelf || '', 
                description
            ]);
        });

        res.status(201).json({ 
            success: true,
            message: 'Inbound transaction created successfully' 
        });
    } catch (error) {
        console.error('Error in inbound transaction:', error);
        res.status(500).json({ 
            success: false,
            error: '입고 처리 중 오류가 발생했습니다.',
            details: error.message 
        });
    }
});

router.post('/outbound', async (req, res) => {
    const { 
        item_id, 
        date,  // 클라이언트에서 받은 날짜
        client, 
        total_quantity, 
        handler_name, 
        warehouse_name, 
        warehouse_shelf, 
        description 
    } = req.body;

    // 날짜를 한국 시간대로 변환
    const kstDate = toKSTDate(date);

    try {
        await db.runTransaction(async (dbTransaction) => {
            // Check current inventory
            const currentInventory = await db.get('SELECT * FROM current_inventory WHERE item_id = $1', [item_id]);
            if (!currentInventory) {
                throw new Error('Item not found in inventory');
            }
            if (currentInventory.current_quantity < total_quantity) {
                throw new Error('Insufficient inventory');
            }

            // Create outbound transaction with KST date
            await db.run(`
                INSERT INTO outbound (
                    item_id, 
                    date, 
                    client, 
                    total_quantity, 
                    handler_name, 
                    warehouse_name, 
                    warehouse_shelf, 
                    description
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                item_id, 
                kstDate,  // 변환된 KST 날짜 사용
                client, 
                total_quantity, 
                handler_name, 
                warehouse_name, 
                warehouse_shelf, 
                description
            ]);
        });

        res.status(201).json({ message: 'Outbound transaction created successfully' });
    } catch (error) {
        console.error('Error in outbound transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;