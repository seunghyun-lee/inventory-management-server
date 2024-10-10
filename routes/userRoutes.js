const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');

router.get('/', async (req, res) => {
    try {
        const users = await db.all('SELECT id, username, handler_name, role FROM users');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: '사용자 목록을 가져오는데 실패했습니다.' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        
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

        await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
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
        const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
        if (!user) {
            return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
        }

        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
        }

        const updateFeilds = [];
        const updateValues = [];

        if (username !== user.username) {
            updateFeilds.push('username = ?');
            updateValues.push(username);
        }

        if (handler_name !== user.handler_name) {
            updateFeilds.push('handler_name = ?');
            updateValues.push(handler_name);
        }

        if (newPassword) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            updateFeilds.push('password = ?');
            updateValues.push(hashedPassword);
        }

        if (updateFeilds.length > 0) {
            const updateQuery = `UPDATE users SET ${updateFeilds.join(', ')} WHERE id = ?`;
            updateValues.push(id);
            await db.run(updateQuery, updateValues);
        }

        const updateUser = await db.get('SELECT id, username, handler_name, role FROM users WHERE id = ?', [id]);

        res.json(updateUser);
    } catch (error) {
        console.log('Error updating user:', error);
        res.status(500).json({ error: '사용자 정보 업데이트 중 오류가 발생했습니다.' });
    }
});

router.post('/signup', async (req, res) => {
    const { username, password, handler_name } = req.body;
    try {
        const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (existingUser) {
            return res.status(400).json({ error: '이미 존재하는 사용자명입니다.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.run(
            'INSERT INTO users (username, password, handler_name, role) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, handler_name, '대기']
        );
        res.status(201).json({ message: '회원가입이 완료되었습니다.', userId: result.lastID });
    } catch (error) {
        console.log('Error in signup:', error);
        res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
    }
});

module.exports = router;