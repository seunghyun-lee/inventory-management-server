const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET events
router.get('/', async (req, res) => {
    try {
        const { start, end } = req.query;
        console.log('Fetching events with params:', { start, end });
        
        // 시작 시간과 종료 시간이 요청된 기간과 겹치는 모든 이벤트를 가져오는 쿼리
        const events = await pool.all(
            `SELECT * FROM events 
            WHERE 
                (start_time <= $2 AND end_time >= $1)
            ORDER BY start_time ASC`,
            [start, end]
        );

        console.log('Found events:', events); // 디버깅용 로그 추가
        res.json(events);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: '일정 조회 중 오류가 발생했습니다.' });
    }
});

// POST event
router.post('/', async (req, res) => {
    try {
        console.log('Received event data:', req.body);

        const {
            title,
            description,
            all_day,
            start_time,
            end_time,
            author,
            location,
            notification,
            color
        } = req.body;

        // 필수 필드 검증
        if (!title || !description || !start_time || !end_time || !author) {
            return res.status(400).json({
                error: '필수 필드가 누락되었습니다.',
                required: ['title', 'description', 'start_time', 'end_time', 'author']
            });
        }

        // 날짜 유효성 검사
        const startDate = new Date(start_time);
        const endDate = new Date(end_time);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({
                error: '잘못된 날짜 형식입니다.',
                start_time,
                end_time
            });
        }

        if (endDate < startDate) {
            return res.status(400).json({
                error: '종료 시간은 시작 시간 이후여야 합니다.'
            });
        }

        const query = `
            INSERT INTO events 
            (title, description, start_time, end_time, all_day, author, location, notification, color)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `;

        const values = [
            title,
            description,
            startDate.toISOString(),
            endDate.toISOString(),
            all_day || false,
            author,
            location || '',
            notification || false,
            color || '#1a73e8'
        ];

        console.log('Executing query with values:', values);

        const result = await pool.query(query, values);
        
        if (!result || !result[0]) {
            throw new Error('이벤트 생성 실패');
        }

        console.log('Created event:', result[0]);
        res.status(201).json(result[0]);
    } catch (error) {
        console.error('Server error creating event:', error);
        res.status(500).json({
            error: '일정 생성 중 오류가 발생했습니다.',
            details: error.message,
        });
    }
});

// PUT event
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            title,
            description,
            all_day,
            start_time,
            end_time,
            author,
            location,
            notification,
            color
        } = req.body;

        console.log('Updating event:', { id, ...req.body });

        // 필수 필드 검증
        if (!title || !description || !start_time || !end_time || !author) {
            return res.status(400).json({
                error: '필수 필드가 누락되었습니다.',
                required: ['title', 'description', 'start_time', 'end_time', 'author']
            });
        }

        // 날짜 유효성 검사
        const startDate = new Date(start_time);
        const endDate = new Date(end_time);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({
                error: '잘못된 날짜 형식입니다.',
                start_time,
                end_time
            });
        }

        if (endDate < startDate) {
            return res.status(400).json({
                error: '종료 시간은 시작 시간 이후여야 합니다.'
            });
        }

        // 기존 이벤트 확인
        const existingEvent = await pool.get(
            'SELECT * FROM events WHERE id = $1',
            [id]
        );

        if (!existingEvent) {
            return res.status(404).json({ error: '해당 일정을 찾을 수 없습니다.' });
        }

        const query = `
            UPDATE events 
            SET 
                title = $1,
                description = $2,
                start_time = $3,
                end_time = $4,
                all_day = $5,
                author = $6,
                location = $7,
                notification = $8,
                color = $9,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
            RETURNING *
        `;

        const values = [
            title,
            description,
            startDate.toISOString(),
            endDate.toISOString(),
            all_day || false,
            author,
            location || '',
            notification || false,
            color || '#1a73e8',
            id
        ];

        console.log('Executing update query with values:', values);

        const updatedEvent = await pool.get(query, values);

        if (!updatedEvent) {
            throw new Error('이벤트 업데이트 실패');
        }

        console.log('Updated event:', updatedEvent);
        res.json(updatedEvent);
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({
            error: '일정 수정 중 오류가 발생했습니다.',
            details: error.message
        });
    }
});

// DELETE event
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const event = await pool.get(
            'DELETE FROM events WHERE id = $1 RETURNING *', 
            [id]
        );

        if (!event) {
            return res.status(404).json({ error: '해당 일정을 찾을 수 없습니다.' });
        }

        res.json({ message: '일정이 삭제되었습니다.' });
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ 
            error: '일정 삭제 중 오류가 발생했습니다.',
            details: error.message 
        });
    }
});

module.exports = router;