const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/inbound', async (req, res) => {
    const { manufacturer, item_name, item_subname, date, supplier, total_quantity, handler_name, warehouse_name, description } = req.body;

    // 입력 데이터 유효성 검사
    if (!manufacturer || !item_name || !item_subname || !date || !supplier || !total_quantity || !handler_name || !warehouse_name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('Received inbound data:', { manufacturer, item_name, item_subname, date, supplier, total_quantity, handler_name, warehouse_name, description });

    try {
        await db.runTransaction(async (dbTransaction) => {
            // 먼저 items 테이블에서 품목을 찾거나 새로 추가합니다.
            let item = await db.get('SELECT id FROM items WHERE manufacturer = ? AND item_name = ?', [manufacturer, item_name]);
        
            if (!item) {
                // 품목이 없으면 새로 추가합니다.
                console.log('Adding new item:', { manufacturer, item_name });
                const result = await db.run('INSERT INTO items (manufacturer, item_name, item_subname) VALUES (?, ?, ?)', [manufacturer, item_name, item_subname]);
                item = { id: result.id };
            }

            // 입고 트랜잭션 생성
            console.log('Creating inbound transaction for item:', item.id);
            await db.run(`
                INSERT INTO inbound (item_id, date, supplier, total_quantity, handler_name, warehouse_name, description) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [item.id, date, supplier, total_quantity, handler_name, warehouse_name, description]);
        });

        res.status(201).json({ message: 'Inbound transaction created successfully' });
    } catch (error) {
        console.error('Error in inbound transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/outbound', async (req, res) => {
    const { item_id, date, client, total_quantity, handler_name, warehouse_name, description } = req.body;

    try {
        await db.runTransaction(async (dbTransaction) => {
            // Check current inventory
            const currentInventory = await db.get('SELECT * FROM current_inventory WHERE item_id = ?', [item_id]);
            if (!currentInventory) {
                throw new Error('Item not found in inventory');
            }
            if (currentInventory.current_quantity < total_quantity) {
                throw new Error('Insufficient inventory');
            }

            // Create outbound transaction
            await db.run(`
                INSERT INTO outbound (item_id, date, client, total_quantity, handler_name, warehouse_name, description)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [item_id, date, client, total_quantity, handler_name, warehouse_name, description]);
        });

        res.status(201).json({ message: 'Outbound transaction created successfully' });
    } catch (error) {
        console.error('Error in outbound transaction:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;