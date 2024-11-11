const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const warehouses = await db.all('SELECT * FROM warehouse');
        res.json({ success: true, data: warehouses });
    } catch (error) {
        console.error('Error fetching warehouses:', error);
        res.status(500).json({ success: false, error: '창고 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/', async (req, res) => {
    const { warehouse } = req.body;
    if (!warehouse || typeof warehouse !== 'string' || warehouse.trim() === '') {
        return res.status(400).json({ success: false, error: '유효한 창고 이름을 입력해주세요.' });
    }
    try {
        await db.run('INSERT INTO warehouse (warehouse) VALUES ($1)', [warehouse.trim()]);
        const newWarehouse = await db.get('SELECT * FROM warehouse WHERE warehouse = $1 ORDER BY id DESC LIMIT 1', [warehouse.trim()]);
        
        if (newWarehouse) {
            res.status(201).json({ 
                success: true, 
                data: { 
                    id: newWarehouse.id, 
                    warehouse: newWarehouse.warehouse 
                } 
            });
        } else {
            throw new Error('Failed to retrieve inserted warehouse');
        }
    } catch (error) {
        console.error('Error adding warehouse:', error);
        res.status(500).json({ success: false, error: '창고 추가에 실패했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 삭제 전에 해당 창고가 존재하는지 확인
        const warehouse = await db.get('SELECT * FROM warehouse WHERE id = $1', [id]);
        if (!warehouse) {
            return res.status(404).json({ success: false, error: '해당 ID의 창고를 찾을 수 없습니다.' });
        }

        // 창고 삭제 실행
        await db.run('DELETE FROM warehouse WHERE id = $1', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting warehouse:', error);
        res.status(500).json({ success: false, error: '창고 삭제에 실패했습니다.' });
    }
});

module.exports = router;