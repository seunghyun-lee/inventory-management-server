const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        
        if (!user) {
            return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
        }

        if (user.role === '퇴사') {
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

module.exports = router;