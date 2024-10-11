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
        const result = await db.run('INSERT INTO warehouse (warehouse) VALUES ($1) RETURNING id', [warehouse.trim()]);
        res.status(201).json({ success: true, data: { id: result.id, warehouse: warehouse.trim() } });
    } catch (error) {
        console.error('Error adding warehouse:', error);
        res.status(500).json({ success: false, error: '창고 추가에 실패했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.run('DELETE FROM warehouse WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: '해당 ID의 창고를 찾을 수 없습니다.' });
        }
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting warehouse:', error);
        res.status(500).json({ success: false, error: '창고 삭제에 실패했습니다.' });
    }
});

module.exports = router;