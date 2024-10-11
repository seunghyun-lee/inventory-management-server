const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const warehouses = await db.all('SELECT * FROM warehouse');
        res.json(warehouses); 
    } catch (error) {
        console.log('Error fetching warehouses:', error);
        res.status(500).json({ error: '창고 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/', async (req, res) => {
    const { warehouse } = req.body;
    try {
        const result = await db.run('INSERT INTO warehouse (warehouse) VALUES (?)', [warehouse]);
        res.status(201).json({ id: result.lastID, warehouse });
    } catch (error) {
        console.error('Error adding warehouse:', error);
        res.status(500).json({ error: '창고 추가에 실패했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM warehouse WHERE id = ?', [id]);
        res.json({ message: '창고가 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting warehouse:', error);
        res.status(500).json({ error: '창고 삭제에 실패했습니다.' });
    }
});

module.exports = router;