const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const manufacturers = await db.all('SELECT * FROM manufacturer');
        res.json({ success: true, data: manufacturers }); 
    } catch (error) {
        console.log('Error fetching manufacturers:', error);
        res.status(500).json({ success: false, error: '제조사 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/', async (req, res) => {
    const { manufacturer } = req.body;
    if (!manufacturer || typeof manufacturer !== 'string' || manufacturer.trim() === '') {
        return res.status(400).json({ success: false, error: '유효한 제조사 이름을 입력해주세요.' });
    }
    try {
        const result = await db.run('INSERT INTO manufacturer (manufacturer) VALUES ($1) RETURNING id', [manufacturer.trim()]);
        res.status(201).json({ success: true, data: { id: result.id, manufacturer: manufacturer.trim() } });
    } catch (error) {
        console.error('Error adding manufacturer:', error);
        res.status(500).json({ success: false, error: '제조사 추가에 실패했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.run('DELETE FROM manufacturer WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: '해당 ID의 제조사를 찾을 수 없습니다.'});
        }
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting manufacturer:', error);
        res.status(500).json({ success: false, error: '제조사 삭제에 실패했습니다.' });
    }
});

module.exports = router;