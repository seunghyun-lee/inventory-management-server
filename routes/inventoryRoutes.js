const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const inventory = await db.all(`
            SELECT 
                i.id, 
                i.manufacturer, 
                i.item_name, 
                i.item_subname, 
                ci.current_quantity, 
                ci.warehouse_name,
                ci.warehouse_shelf,
                ci.description
            FROM 
                items i
            INNER JOIN 
                current_inventory ci ON i.id = ci.item_id
            WHERE
                ci.current_quantity > 0
            ORDER BY
                i.manufacturer, i.item_name, i.item_subname
        `);
        res.json(inventory);
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const item = await db.get(`
            SELECT 
                i.id, 
                i.manufacturer, 
                i.item_name,
                i.item_subname,
                ci.current_quantity,
                ci.warehouse_name,
                ci.warehouse_shelf
            FROM 
                items i
            LEFT JOIN 
                current_inventory ci ON i.id = ci.item_id
            WHERE
                i.id = $1
            `, [req.params.id]);

        if (!item) {
            return res.status(404).json({ message: 'Item not found' });
        }

        res.json(item);
    } catch (error) {
        console.error('Error fetching item details:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const id = await Inventory.create(req.body);
        res.status(201).json({ id, message: 'Item created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await db.runTransaction(async (transaction) => {
            // inbound 테이블에서 관련 기록 삭제
            await db.run('DELETE FROM inbound WHERE item_id = $1', [id]);

            // outbound 테이블에서 관련 기록 삭제
            await db.run('DELETE FROM outbound WHERE item_id = $1', [id]);

            // items 테이블에서 항목 삭제
            await db.run('DELETE FROM items WHERE id = $1', [id]);

            // current_inventory 뷰는 자동으로 업데이트됨
        });

        res.json({ message: '재고 항목이 성공적으로 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting inventory item:', error);
        res.status(500).json({ error: '재고 항목 삭제 중 오류가 발생했습니다.' });
    }
});

module.exports = router;