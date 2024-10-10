const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const manufacturers = await db.all('SELECT * FROM manufacturer');
        res.json(manufacturers); 
    } catch (error) {
        console.log('Error fetching manufacturers:', error);
        res.status(500).json({ error: '제조사 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/', async (req, res) => {
    const { manufacturer } = req.body;
    try {
        const result = await db.run('INSERT INTO manufacturer (manufacturer) VALUES (?)', [manufacturer]);
        res.status(201).json({ id: result.lastID, manufacturer });
    } catch (error) {
        console.error('Error adding manufacturer:', error);
        res.status(500).json({ error: '제조사 추가에 실패했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM manufacturer WHERE id = ?', [id]);
        res.json({ message: '제조사가 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting manufacturer:', error);
        res.status(500).json({ error: '제조사 삭제에 실패했습니다.' });
    }
});

module.exports = router;