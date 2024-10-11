const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const shelfs = await db.all('SELECT * FROM shelf');
        res.json(shelfs); 
    } catch (error) {
        console.log('Error fetching shelfs:', error);
        res.status(500).json({ error: '위치 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/', async (req, res) => {
    const { shelf } = req.body;
    try {
        const result = await db.run('INSERT INTO shelf (shelf) VALUES (?)', [shelf]);
        res.status(201).json({ id: result.lastID, shelf });
    } catch (error) {
        console.error('Error adding shelf:', error);
        res.status(500).json({ error: '위치 추가에 실패했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM shelf WHERE id = ?', [id]);
        res.json({ message: '위치가 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting shelf:', error);
        res.status(500).json({ error: '위치 삭제에 실패했습니다.' });
    }
});

module.exports = router;