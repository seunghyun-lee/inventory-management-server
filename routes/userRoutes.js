const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

router.get('/', async (req, res) => {
    try {
        const users = await db.query('SELECT id, username, handler_name, role FROM users');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: '사용자 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await db.get('SELECT * FROM users WHERE username = $1', [username]);
        
        if (!user) {
            return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
        }

        if (user.role === '퇴사' || user.role === '대기') {
            return res.status(403).json({ error: '권한이 없어서 로그인이 불가능합니다.' });
        }

        // 비밀번호를 제외한 사용자 정보 반환
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        console.error('Error in login:', error);
        res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
    }
});

router.put('/:id/role', async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    try {
        const validRoles = ['관리자', '직원', '퇴사', '대기'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: '유효하지 않은 역할입니다.' });
        }

        await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
        res.json({ message: '사용자 역할이 업데이트되었습니다.' });
    } catch (error) {
        console.log('Error updating user role:', error);
        res.status(500).json({ error: '사용자 역할 업데이트에 실패했습니다.' });
    }
});

router.put('/:id/profile', async (req, res) => {
    const { id } = req.params;
    const { username, handler_name, currentPassword, newPassword } = req.body;
    
    try {
        const userResult = await db.query('SELECT * FROM users WHERE id = $1', [id]);
        const user = userResult[0];
        if (!user) {
            return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
        }

        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
        }

        let updateQuery = 'UPDATE users SET ';
        const updateValues = [];
        let paramCount = 1;

        if (username !== user.username) {
            updateQuery += `username = $${paramCount}, `;
            updateValues.push(username);
            paramCount++;
        }

        if (handler_name !== user.handler_name) {
            updateQuery += `handler_name = $${paramCount}, `;
            updateValues.push(handler_name);
            paramCount++;
        }

        if (newPassword) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            updateQuery += `password = $${paramCount}, `;
            updateValues.push(hashedPassword);
            paramCount++;
        }

        // Remove trailing comma and space
        updateQuery = updateQuery.slice(0, -2);

        if (updateValues.length > 0) {
            updateQuery += ` WHERE id = $${paramCount}`;
            updateValues.push(id);
            await db.query(updateQuery, updateValues);
        }

        const updatedUserResult = await db.query('SELECT id, username, handler_name, role FROM users WHERE id = $1', [id]);
        const updatedUser = updatedUserResult[0];

        res.json(updatedUser);
    } catch (error) {
        console.log('Error updating user:', error);
        res.status(500).json({ error: '사용자 정보 업데이트 중 오류가 발생했습니다.' });
    }
});

router.post('/signup', async (req, res) => {
    const { username, password, handler_name } = req.body;
    try {
        const existingUserResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUserResult.length > 0) {
            return res.status(400).json({ error: '이미 존재하는 사용자명입니다.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.query(
            'INSERT INTO users (username, password, handler_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
            [username, hashedPassword, handler_name, '대기']
        );
        res.status(201).json({ message: '회원가입이 완료되었습니다.', userId: result[0].id });
    } catch (error) {
        console.log('Error in signup:', error);
        res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
    }
});

module.exports = router;