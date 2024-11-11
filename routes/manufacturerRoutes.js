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
        // INSERT 실행
        await db.run('INSERT INTO manufacturer (manufacturer) VALUES ($1)', [manufacturer.trim()]);
        
        // 새로 추가된 제조사 조회
        const newManufacturer = await db.get(
            'SELECT * FROM manufacturer WHERE manufacturer = $1 ORDER BY id DESC LIMIT 1', 
            [manufacturer.trim()]
        );
        
        if (newManufacturer) {
            res.status(201).json({ 
                success: true, 
                data: { 
                    id: newManufacturer.id, 
                    manufacturer: newManufacturer.manufacturer 
                } 
            });
        } else {
            throw new Error('Failed to retrieve inserted manufacturer');
        }
    } catch (error) {
        console.error('Error adding manufacturer:', error);
        res.status(500).json({ success: false, error: '제조사 추가에 실패했습니다.' });
    }
});

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // 삭제 전에 해당 제조사가 존재하는지 확인
        const manufacturer = await db.get('SELECT * FROM manufacturer WHERE id = $1', [id]);
        if (!manufacturer) {
            return res.status(404).json({ success: false, error: '해당 ID의 제조사를 찾을 수 없습니다.' });
        }

        // 제조사 삭제 실행
        await db.run('DELETE FROM manufacturer WHERE id = $1', [id]);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting manufacturer:', error);
        res.status(500).json({ success: false, error: '제조사 삭제에 실패했습니다.' });
    }
});

module.exports = router;